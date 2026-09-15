/**
 * 4대보험 EDI 파일 생성기
 *
 * ⚠️ 폐기 예정 / 제출용 아님 (2026-07-23 P0).
 *   아래 generateInsuranceEDI 는 공식 규격이 아닌 자체 INI 텍스트([HEAD]/[RECORD]/[FOOT])를
 *   보험별 .txt 4개로 만든다. 국민건강보험 Web EDI 는 "4대보험 전체신청용 XLSX 1개"(정해진 열
 *   순서·코드값)만 받으므로 이 파일은 "허용되지 않은 확장자입니다"로 거부된다. 주민번호도 placeholder.
 *   → 어떤 화면에서도 이 함수 결과를 "제출용"으로 다운로드시키지 말 것. 취득/상실 패널은 이미 비활성화됨.
 *   정식 XLSX 규격(공식 예제 XLS 기준)으로 교체 예정 — 그 전까지 신규 배선 금지.
 *   공식 규격: https://edi.nhis.or.kr/webedi/file_sy/all_chuiduk.html (취득) / all_sangsil.html (상실)
 */

export type InsuranceType = 'national_pension' | 'health' | 'employment' | 'industrial_accident';
export type ReportType = 'acquisition' | 'loss'; // 취득/상실

interface EmployeeInsuranceData {
  name: string;
  residentNumber: string; // 주민등록번호 (masked: 000000-0******)
  joinDate?: string; // YYYYMMDD
  leaveDate?: string;
  monthlySalary: number;
  department?: string;
  position?: string;
  leaveReason?: string; // 상실사유코드
}

interface CompanyInsuranceData {
  companyName: string;
  businessNumber: string; // 사업자등록번호
  workplaceCode?: string; // 사업장관리번호
  representativeName: string;
  address?: string;
}

interface EDIResult {
  insuranceType: InsuranceType;
  reportType: ReportType;
  filename: string;
  content: string; // EDI formatted text
  employeeCount: number;
}

// Insurance type labels in Korean
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
