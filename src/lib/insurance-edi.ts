/**
 * 4대보험 취득·상실 신고 파일 — 국민건강보험 EDI 「파일 신고」 규격 (2026-09-22 ERP 공백 2차 ⑤)
 *
 *   History — 2026-07-23 까지 있던 generateInsuranceEDI 는 공식 규격이 아닌 자체 INI 텍스트라 EDI 가 거부했다(패널 비활성).
 *   공식 예제·규격은 docs/reference/nhis-edi (edi.nhis.or.kr/webedi/file_sy/all_chuiduk.html · all_sangsil.html, 로그인 없이 받아짐).
 *
 *   기준(무엇으로 판단하나)
 *   · 파일 = 예제 xls 의 열 순서 그대로, **신고 줄만**(주의사항·필드명 줄 없음 — 규격이 지우고 올리라 한다). 시트 하나. 한 파일 500명.
 *   · 모든 칸은 글자로 쓴다(부호 "01"·"000" 의 앞 0 이 숫자로 바뀌면 거절된다). 날짜 YYYYMMDD, 금액은 원 단위 숫자 글자.
 *   · 취득: 자격취득일 = 입사일. 보수월액·소득월액·월평균보수 = 약정 월급. 연금 취득부호 01·건강 00·특수직종 0·직역연금 0·단위사업장 000/회사명·
 *     건강보험증 사업장발송 2·취득월납부 2 가 기본 — 화면에서 고칠 수 있다. 직종은 회사가 마지막에 쓴 값을 기억한다.
 *   · 상실: **자격상실일 = 퇴직일 다음 날**(4대보험 공통 규칙). 연금 상실부호 03(사용관계종료)·건강 01(퇴직) 기본.
 *     보수총액 = 발송된 급여 명세의 과세액 합(결정 101 과 같은 식), 산정월수 = 명세가 있는 달 수. 전년도는 전년에 입사한 사람만 정산구분 2.
 *     고용 상실사유 = 퇴사 처리 때 고른 코드(offboarding.loss_reason 의 앞 두 자리), 구체적 사유 = 그 라벨.
 *   · 주민등록번호는 등록된 직원만 파일을 만드는 순간 RPC(get_rrns_for_insurance, 열람 기록 남음)로 받는다. 미등록은 파일에서 빼고 알린다.
 *   · 자동으로 못 푸는 것: 직종·대표자 여부·외국인 국적/체류자격·감면·보험료부과구분 — 화면 칸으로 남기고 기본값은 빈 칸(지어내지 않는다).
 */

import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";

export type InsuranceType = 'national_pension' | 'health' | 'employment' | 'industrial_accident';
export type ReportType = 'acquisition' | 'loss'; // 취득/상실

export const INSURANCE_LABELS: Record<InsuranceType, string> = {
  national_pension: '국민연금',
  health: '건강보험',
  employment: '고용보험',
  industrial_accident: '산재보험',
};

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  acquisition: '취득신고',
  loss: '상실신고',
};

//   구체적 사유(세부코드) — 대분류 코드를 고른 뒤 이어서 고른다(예: 26 → 26-1·26-2·26-3). 위하고 등 급여 시스템과 같은 2단계.
export type LossReasonSub = { code: string; label: string };
export type LossReason = { code: string; label: string; group: string; enabled?: boolean; subs?: LossReasonSub[] };

// 상실사유 기본값 — 고용보험 상실신고·이직확인서 구분코드(근로복지공단). 4개 묶음.
//   일부 코드는 구체적 사유(세부코드)를 갖는다 — 그 코드를 고르면 세부코드를 이어서 고른다.
//   묶음(group)은 화면에서 optgroup 으로 나눠 고르기 쉽게 한다.
export const DEFAULT_LOSS_REASONS: LossReason[] = [
  { group: '자진퇴사', code: '11', label: '개인사정으로 인한 자진퇴사', subs: [{ code: '11-1', label: '다른 직장으로 옮기기 위해 이직한 경우' }, { code: '11-2', label: '본인이나 가족사업 등을 하기 위하여 이직한 경우' }, { code: '11-3', label: '결혼·출산·육아를 이유로 이직한 경우' }, { code: '11-4', label: '가족(배우자 또는 부양해야 할 친족)과의 동거를 위하여 주소이전' }, { code: '11-5', label: '노약자 간호를 위하여' }, { code: '11-6', label: '자녀교육을 위하여' }, { code: '11-7', label: '사업장의 출퇴근이 곤란하여' }, { code: '11-8', label: '질병·부상으로 업무수행이 곤란하여 이직한 경우' }, { code: '11-9', label: '체력·시력·청력의 쇠퇴로 업무수행이 곤란하여 이직한 경우' }, { code: '11-10', label: '고연령으로 업무수행이 곤란하여 이직한 경우' }, { code: '11-11', label: '본인의 업무상 과실 또는 능력 부족' }, { code: '11-12', label: '학업 또는 시험대비를 위하여' }, { code: '11-13', label: '병역의무를 이행하기 위해서 이직(*수급자격 있음)' }, { code: '11-14', label: '본인의 사망' }, { code: '11-15', label: '본인이 쉬고 싶어서' }, { code: '11-16', label: '위에 해당하지 않는 개인사정(직접 구체적으로 입력)' }] },
  { group: '자진퇴사', code: '12', label: '사업장 이전, 근로조건 변동, 임금체불 등으로 자진퇴사', subs: [{ code: '12-1', label: '계속되는 휴업·휴직으로' }, { code: '12-2', label: '임금 등의 체불 또는 지연지급이 계속되어' }, { code: '12-3', label: '사업장의 이전으로 출·퇴근이 곤란해서' }, { code: '12-4', label: '통근이 불가능한 지역으로 전근되어' }, { code: '12-5', label: '타당성 없는 보직변경으로' }, { code: '12-6', label: '임금·근로조건이 현저히 낮아져서' }] },
  { group: '회사사정과 근로자 귀책사유에 의한 이직', code: '22', label: '폐업·도산(예정 포함), 공사중단', subs: [{ code: '22-1', label: '사업장의 도산·폐업이 확정·실현되어서' }, { code: '22-2', label: '천재지변 등으로 사업 불가능' }, { code: '22-3', label: '사업이 중단되고 재개될 전망이 없어서' }] },
  { group: '회사사정과 근로자 귀책사유에 의한 이직', code: '23', label: '경영상 필요 및 회사 불황으로 인원감축 등에 의한 퇴사(해고·권고사직·명예퇴직 포함)', subs: [{ code: '23-1', label: '경영상 필요에 의한 인원 감축' }, { code: '23-2', label: '사업의 양도·양수·합병으로' }, { code: '23-3', label: '인원감축을 위한 희망퇴직에 응해서' }, { code: '23-4', label: '사업·부서가 폐지되고 신설된 법인으로 전직' }, { code: '23-5', label: '회사의 업종전환에 적응하지 못해서' }, { code: '23-6', label: '회사의 주문량·작업량 감소로' }, { code: '23-7', label: '대량감원이 예상되어 스스로 사직' }, { code: '23-8', label: '결혼·군입대 등의 경우 퇴직하는 관행에 따라 이직(권고사직 포함)' }, { code: '23-9', label: '이직 전 3월 이상 임금이 낮거나 근로시간 과다' }, { code: '23-10', label: '관례적·일상적인 명예퇴직' }] },
  { group: '회사사정과 근로자 귀책사유에 의한 이직', code: '26', label: '근로자의 귀책사유에 의한 징계해고 및 권고사직', subs: [{ code: '26-1', label: '징계해고로 인한 이직' }, { code: '26-2', label: '징계해고에 해당하나 사업주가 권유해서' }, { code: '26-3', label: '근로자의 귀책사유가 징계해고 정도에는 해당되지 않지만(업무능력 미달 사유 등 포함) 사업주가 권유하여 사직한 경우' }] },
  { group: '정년 등 기간만료에 의한 이직', code: '31', label: '정년', subs: [{ code: '31-1', label: '정년' }] },
  { group: '정년 등 기간만료에 의한 이직', code: '32', label: '계약기간 만료, 공사종료', subs: [{ code: '32-1', label: '근로계약의 기간만료' }, { code: '32-2', label: '조건부계약의 조건성취' }, { code: '32-3', label: '공사계약의 기간만료' }] },
  { group: '기타', code: '41', label: '고용보험 비적용, 이중고용', subs: [{ code: '41-1', label: '고용보험 적용제외 근로자로 되어 상실' }, { code: '41-2', label: '사업장의 보험관계 해지' }, { code: '41-3', label: '임의가입자의 가입탈퇴 승인' }, { code: '41-4', label: '다른 사업장에서 피보험자격 취득' }] },
];

// ── 공단 규격 부호표 (edi.nhis.or.kr 파일 사양서 그대로) ─────────────────────────────
export type Code = { code: string; label: string };
/** 공단구분 — 연금·건강·고용·산재 순서 Y/N */
export const AGENCY_PATTERNS: Code[] = [
  { code: "YYYY", label: "연금·건강·고용·산재" }, { code: "YYYN", label: "연금·건강·고용" }, { code: "YYNY", label: "연금·건강·산재" }, { code: "YYNN", label: "연금·건강" },
  { code: "YNYY", label: "연금·고용·산재" }, { code: "YNYN", label: "연금·고용" }, { code: "YNNY", label: "연금·산재" }, { code: "YNNN", label: "연금" },
  { code: "NYYY", label: "건강·고용·산재" }, { code: "NYYN", label: "건강·고용" }, { code: "NYNY", label: "건강·산재" }, { code: "NYNN", label: "건강" },
  { code: "NNYY", label: "고용·산재" }, { code: "NNYN", label: "고용" }, { code: "NNNY", label: "산재" },
];
export const NP_ACQ_CODES: Code[] = [
  { code: "01", label: "18세이상당연취득" }, { code: "03", label: "18세미만취득" }, { code: "09", label: "전입[사업장 통,폐합]" }, { code: "11", label: "대학시간강사" },
  { code: "12", label: "60시간 미만 신청 취득" }, { code: "14", label: "일용근로자, 단시간근로자 등" }, { code: "15", label: "상실취소" },
];
export const HI_ACQ_CODES: Code[] = [
  { code: "00", label: "최초취득" }, { code: "04", label: "의료급여 해제" }, { code: "05", label: "직장가입자 상실" }, { code: "06", label: "직장피부양자 상실" }, { code: "07", label: "지역가입자에서 변경" },
  { code: "10", label: "국가유공자 건강보험 적용신청" }, { code: "13", label: "기타" }, { code: "14", label: "직권말소후 재등록" }, { code: "29", label: "직장가입자 이중자격" }, { code: "30", label: "상실취소" },
];
export const HI_REDUCTION_CODES: Code[] = [
  { code: "", label: "없음" }, { code: "11", label: "국외근무(전액면제)" }, { code: "12", label: "국외근무(반액면제)" }, { code: "21", label: "군입대" }, { code: "22", label: "상근예비역(현역입대)" },
  { code: "24", label: "상근예비역소집" }, { code: "31", label: "시설수용(교도소)" }, { code: "41", label: "도서벽지(사업자)" }, { code: "42", label: "도서벽지(거주지)" }, { code: "43", label: "도서벽지(파견지)" },
];
export const NP_LOSS_CODES: Code[] = [
  { code: "01", label: "사망" }, { code: "03", label: "사용관계종료" }, { code: "04", label: "국적상실(국외이주)" }, { code: "05", label: "60세도달" }, { code: "06", label: "다른 공적연금 가입" },
  { code: "09", label: "전출(통, 폐합)" }, { code: "15", label: "60세 미만 노령연금수급권자" }, { code: "16", label: "협정국 연금가입" }, { code: "19", label: "체류기간 만료(외국인)" },
  { code: "20", label: "적용제외 체류자격(외국인)" }, { code: "21", label: "무보수 대표이사" }, { code: "22", label: "근로자 제외" }, { code: "26", label: "취득취소" },
];
export const HI_LOSS_CODES: Code[] = [
  { code: "01", label: "퇴직" }, { code: "02", label: "사망" }, { code: "04", label: "의료보호책정" }, { code: "10", label: "국가유공자의료보호책정" }, { code: "16", label: "취득취소" },
];
export const EI_LOSS_CODES: Code[] = [
  { code: "11", label: "개인사정으로 인한 자진퇴사" }, { code: "12", label: "사업장 이전, 근로조건변동, 임금체불등으로 자진퇴사" }, { code: "22", label: "폐업, 도산" },
  { code: "23", label: "경영상 필요 및 회사불황으로 인원감축등에 의한 퇴사(해고, 권고사직, 명예퇴직 포함)" }, { code: "26", label: "근로자의 귀책사유에 의한 징계해고, 권고사직" },
  { code: "31", label: "정년" }, { code: "32", label: "계약기간 만료, 공사종료" }, { code: "41", label: "고용보험 비적용" }, { code: "42", label: "이중고용" },
];
/** 고용·산재 직종 (한국고용직업분류 소분류, 규격 페이지 순서) */
export const JOB_CODES: Code[] = [
  ["011","의회의원·고위공무원 및 기업 고위임원"],["012","행정·경영·금융·보험 관리자"],["013","전문서비스 관리자"],["014","미용·여행·숙박·음식·경비·청소 관리자"],["015","영업·판매·운송 관리자"],["016","건설·채굴·제조·생산 관리자"],
  ["021","정부행정 전문가 및 관련 종사자"],["022","경영·인사 전문가"],["023","회계·세무·감정 전문가"],["024","광고·조사·상품기획·행사기획 전문가"],["025","정부행정 사무원"],["026","경영지원 사무원"],["027","회계·경리 사무원"],["028","무역·운송·생산·품질 사무원"],["029","안내·고객상담·통계·비서 및 기타 사무원"],
  ["031","금융·보험 전문가"],["032","금융·보험 사무원"],["033","금융·보험 영업원"],["102","부동산 중개인"],["103","판매원 및 상품대여원"],
  ["110","인문·사회과학 연구원"],["121","자연과학 연구원 및 시험원"],["122","생명과학 연구원 및 시험원"],
  ["131","컴퓨터하드웨어·통신공학 기술자"],["132","컴퓨터시스템 전문가"],["133","소프트웨어 개발자"],["134","네트워크 시스템 개발자 및 정보보안 전문가"],["135","데이터 전문가"],["136","정보시스템 및 웹 운영자"],["137","통신·방송송출 장비 기사"],
  ["140","건축·토목공학 기술자 및 시험원"],["151","기계·로봇공학 기술자 및 시험원"],["152","금속·재료공학 기술자 및 시험원"],["153","전기·전자공학 기술자 및 시험원"],["154","화학공학 기술자 및 시험원"],["155","에너지·환경공학 기술자 및 시험원"],["156","섬유공학 기술자 및 시험원"],["157","식품공학 기술자 및 시험원"],["158","소방·방재·산업안전·비파괴 기술자"],["159","제도사 및 기타 공학 기술자 및 시험원"],
  ["211","대학 교수 및 강사"],["212","학교 교사"],["213","유치원 교사"],["214","문리·기술·예능 강사"],["215","장학관 및 기타 교육 종사자"],["221","법률 전문가"],["222","법률 사무원"],["231","사회복지사 및 상담사"],["232","보육교사 및 기타 사회복지 종사자"],["233","성직자 및 기타 종교 종사자"],["240","경찰관, 소방관 및 교도관"],["250","군인"],
  ["301","의사, 한의사 및 치과의사"],["302","수의사"],["303","약사 및 한약사"],["304","간호사"],["305","영양사"],["306","의료기사·치료사·재활사"],["307","보건·의료 종사자"],
  ["411","작가·통번역가"],["412","기자 및 언론 전문가"],["413","학예사·사서·기록물관리사"],["414","창작·공연 전문가(작가, 연극 제외)"],["415","디자이너"],["416","연극·영화·방송 전문가"],["417","문화·예술 기획자 및 매니저"],["420","스포츠·레크리에이션 종사자"],
  ["511","미용 서비스원"],["512","결혼·장례 등 예식 서비스원"],["513","반려동물 서비스원"],["521","여행 서비스원"],["522","항공기·선박·열차 객실승무원"],["523","숙박시설 서비스원"],["524","오락시설 서비스원"],["531","주방장 및 조리사"],["532","식당 서비스원"],["541","경호·보안 종사자"],["542","경비원"],["550","돌봄 서비스 종사자"],["561","청소 종사자"],["562","세정원 및 방역원"],["563","가사 서비스원"],["564","검침·주차관리 및 기타 서비스 단순 종사자"],
  ["611","부동산 컨설턴트 및 중개사"],["612","기술·해외 영업원 및 상품중개인"],["613","자동차 및 제품 영업원"],["614","텔레마케터"],["615","판매 종사자"],["616","매장 계산원 및 매표원"],["617","판촉 및 기타 판매 단순 종사자"],["621","항공기·선박·철도 조종사 및 관제사"],["622","자동차 운전원"],["623","물품이동장비 조작원(크레인·호이스트·지게차)"],["624","택배원 및 기타 운송 종사자"],
  ["701","건설구조 기능원"],["702","건축마감 기능원"],["703","배관공"],["704","건설·채굴 기계 운전원"],["705","기타 건설 기능원(채굴포함)"],["706","건설·채굴 단순 종사자"],
  ["811","기계장비 설치·정비원(운송장비 제외)"],["812","운송장비 정비원"],["813","금형원 및 공작기계 조작원"],["814","냉·난방 설비 조작원"],["815","자동조립라인·산업용로봇 조작원"],["816","기계 조립원(운송장비 제외)"],["817","운송장비 조립원"],["821","금속관련 기계·설비 조작원"],["822","판금원 및 제관원"],["823","단조원 및 주조원"],["824","용접원 및 용접기 조작원"],["825","도장원 및 도금원"],["826","비금속제품 생산기계 조작원"],
  ["831","전기공"],["832","전기·전자 기기 설치·수리원"],["833","발전·배전 장치 조작원"],["834","전기·전자 설비 조작원"],["835","전기·전자 부품·제품 생산기계 조작원"],["836","전기·전자 부품·제품 조립원"],["841","정보통신기기 설치·수리원"],["842","방송·통신장비 설치·수리원"],
  ["851","석유·화학물 가공장치 조작원"],["852","고무·플라스틱 및 화학제품 생산기계 조작원 및 조립원"],["853","환경관련 장치 조작원"],["861","섬유 제조·가공 기계 조작원"],["862","패턴사, 재단사 및 재봉사"],["863","의복 제조원 및 수선원"],["864","제화원, 기타 섬유·의복 기계 조작원 및 조립원"],
  ["871","제과·제빵원 및 떡제조원"],["872","식품 가공 기능원"],["873","식품 가공 기계 조작원"],["881","인쇄기계·사진현상기 조작원"],["882","목재·펄프·종이 생산기계 조작원"],["883","가구·목제품 제조·수리원"],["884","공예원 및 귀금속세공원"],["885","악기·간판 및 기타 제조 종사자"],["890","제조 단순 종사자"],
  ["901","작물재배 종사자"],["902","낙농·사육 종사자"],["903","임업 종사자"],["904","어업 종사자"],["905","농림어업 단순 종사자"],
].map(([code, label]) => ({ code, label }));

// ── 신고 줄 ─────────────────────────────────────────────────────────────────────
export type AcqRow = {
  employeeId: string; name: string; rrn?: string; agencies: string; isRep: "1" | "2";
  acqDate: string;            // YYYY-MM-DD (파일엔 YYYYMMDD)
  monthlyPay: number;         // 소득월액·보수월액·월평균보수
  npCode: string; npPayFirstMonth: "1" | "2"; npSpecial: "0" | "1" | "2"; npPublic: "0" | "1" | "2";
  hiUnitCode: string; hiUnitName: string; hiCode: string; hiReduction: string; hiCardToWork: "1" | "2";
  jobCode: string; weeklyHours: number; isContract: "1" | "2"; contractEnd: string;   // YYYY-MM
  nationality: string; stayStatus: string;
};
export type LossRow = {
  employeeId: string; name: string; rrn?: string; phone: string; agencies: string;
  lossDate: string;           // YYYY-MM-DD — 퇴직일 다음 날
  npCode: string; npFirstMonthPay: "1" | "2";
  hiCode: string; curPay: number; curMonths: number; prevSettle: "0" | "2"; prevPay: number; prevMonths: number;
  eiCode: string; eiDetail: string;
};

const d8 = (s: string) => String(s || "").replace(/\D/g, "").slice(0, 8);
const ym6 = (s: string) => String(s || "").replace(/\D/g, "").slice(0, 6);
const n = (v: number) => String(Math.max(0, Math.round(Number(v) || 0)));
const y = (agencies: string, i: number) => agencies[i] === "Y";

/** 취득 신고 줄 → 규격 39칸 (공통 6 · 연금 6 · 건강 9 · 고용 9 · 산재 9). 안 하는 공단의 칸은 빈 칸 */
export function acqToCells(r: AcqRow): string[] {
  const np = y(r.agencies, 0), hi = y(r.agencies, 1), ei = y(r.agencies, 2), ia = y(r.agencies, 3);
  const eiBlock = (on: boolean) => on ? [d8(r.acqDate), r.jobCode, String(Math.round(r.weeklyHours)).padStart(2, "0"), r.isContract, r.isContract === "1" ? ym6(r.contractEnd) : "", n(r.monthlyPay), "", "", ""] : ["", "", "", "", "", "", "", "", ""];
  return [
    r.agencies, r.name, String(r.rrn || "").replace(/\D/g, ""), r.nationality || "", r.stayStatus || "", r.isRep,
    ...(np ? [n(r.monthlyPay), r.npPayFirstMonth, r.npCode, d8(r.acqDate), r.npSpecial, r.npPublic] : ["", "", "", "", "", ""]),
    ...(hi ? [r.hiUnitCode || "000", r.hiUnitName || "", n(r.monthlyPay), r.hiCode, d8(r.acqDate), r.hiReduction || "", r.hiCardToWork, "", ""] : ["", "", "", "", "", "", "", "", ""]),
    ...eiBlock(ei), ...eiBlock(ia),
  ];
}

/** 상실 신고 줄 → 규격 22칸 (공통 4 · 연금 3 · 건강 7 · 고용 5 · 산재 3) */
export function lossToCells(r: LossRow): string[] {
  const np = y(r.agencies, 0), hi = y(r.agencies, 1), ei = y(r.agencies, 2), ia = y(r.agencies, 3);
  return [
    r.agencies, r.name, String(r.rrn || "").replace(/\D/g, ""), r.phone || "",
    ...(np ? [d8(r.lossDate), r.npCode, r.npFirstMonthPay] : ["", "", ""]),
    ...(hi ? [d8(r.lossDate), r.hiCode, n(r.curPay), String(r.curMonths), r.prevSettle, r.prevSettle === "2" ? n(r.prevPay) : "0", r.prevSettle === "2" ? String(r.prevMonths) : "0"] : ["", "", "", "", "", "", ""]),
    ...(ei ? [r.eiCode, r.eiDetail || "", d8(r.lossDate), n(r.curPay), n(r.prevPay)] : ["", "", "", "", ""]),
    ...(ia ? [d8(r.lossDate), n(r.curPay), n(r.prevPay)] : ["", "", ""]),
  ];
}

/** 시트 하나 · 신고 줄만 · 전부 글자 셀 — EDI 파일송신함 가져오기에 그대로 올린다 */
export function downloadInsuranceXlsx(kind: ReportType, rows: string[][], fileStamp: string) {
  const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((c) => String(c ?? ""))));
  for (const addr of Object.keys(ws)) { if (addr[0] !== "!") (ws as any)[addr].t = "s"; }   // 앞 0 보존
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, `4대보험_${kind === "acquisition" ? "취득신고" : "상실신고"}_${fileStamp}.xlsx`);
}

/** 규격 검사 — 파일을 만들기 전에 빠진 칸을 사람에게 알린다 */
export function validateAcq(r: AcqRow): string[] {
  const out: string[] = [];
  if (!r.rrn || r.rrn.replace(/\D/g, "").length !== 13) out.push("주민등록번호");
  if (!d8(r.acqDate) || d8(r.acqDate).length !== 8) out.push("자격취득일");
  if (!(r.monthlyPay > 0)) out.push("보수월액");
  if ((y(r.agencies, 2) || y(r.agencies, 3)) && !r.jobCode) out.push("직종");
  if ((y(r.agencies, 2) || y(r.agencies, 3)) && r.isContract === "1" && ym6(r.contractEnd).length !== 6) out.push("계약직 종료년월");
  if (!/^[YN]{4}$/.test(r.agencies) || !r.agencies.includes("Y")) out.push("공단구분");
  return out;
}
export function validateLoss(r: LossRow): string[] {
  const out: string[] = [];
  if (!r.rrn || r.rrn.replace(/\D/g, "").length !== 13) out.push("주민등록번호");
  if (d8(r.lossDate).length !== 8) out.push("상실일");
  if (y(r.agencies, 2) && !r.eiCode) out.push("고용 상실사유");
  if (!/^[YN]{4}$/.test(r.agencies) || !r.agencies.includes("Y")) out.push("공단구분");
  return out;
}

// ── 회사가 마지막에 쓴 직종 기억 (company_settings.settings.insurance_edi.job_code) ──
export async function loadJobDefault(companyId: string): Promise<string> {
  const { data } = await (supabase as any).from("company_settings").select("settings").eq("company_id", companyId).maybeSingle();
  return String(data?.settings?.insurance_edi?.job_code || "");
}
export async function saveJobDefault(companyId: string, jobCode: string) {
  const { data } = await (supabase as any).from("company_settings").select("id, settings").eq("company_id", companyId).maybeSingle();
  const settings = { ...((data?.settings as Record<string, unknown>) || {}), insurance_edi: { ...((data?.settings?.insurance_edi as Record<string, unknown>) || {}), job_code: jobCode } };
  if (data?.id) await (supabase as any).from("company_settings").update({ settings }).eq("id", data.id);
  else await (supabase as any).from("company_settings").insert({ company_id: companyId, settings });
}

/** 등록된 직원의 주민등록번호 — 만드는 순간에만, 열람 기록이 남는다(get_insurance) */
export async function fetchRrnsForInsurance(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await (supabase as any).rpc("get_rrns_for_insurance", { p_employee_ids: ids.slice(i, i + 500) });
    if (error) throw error;
    for (const r of (data || []) as any[]) out.set(r.employee_id as string, r.rrn as string);
  }
  return out;
}

/** 다음 날 (자격상실일 = 퇴직일 + 1) */
export function nextDay(d: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}
