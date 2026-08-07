// 프로젝트 표(보드) — 새 프로젝트 구조의 뼈대 (2026-08-03 기획 v2, 사장님 승인).
//
//   프로젝트 1 : N 표 : N 그룹 : N 행.  값은 행의 jsonb 한 칸(컬럼ID → 값)에 담는다.
//   컬럼을 더해도 DB 구조를 바꾸지 않는다.
//
// 템플릿은 **부서가 아니라 일의 형태**로 나눈다 — 같은 표가 여러 업무를 덮는다.
//   예: '집행 · 성과' 하나가 마케팅 캠페인 · 광고 · 전시회 · 교육 · 지원사업 집행에 다 쓰인다.
//
// 단계는 '섹션'이 아니라 '라벨'이다 (2026-08-03 사장님: "요청·작업중·검수·완료로 섹션이
//   나뉘어 있는데 굳이 섹션까지 나눌 필요 없이 기본 라벨로 제공하는 게 좋겠다")
//   · 모든 템플릿은 **그룹 하나**로 시작한다. 단계는 상태 컬럼의 **기본 라벨**로 준다.
//   · 그래서 단계 이동 = 셀에서 라벨 바꾸기 = 칸반에서 카드 끌기. 셋이 같은 값을 만진다.
//   · 그룹은 사용자가 필요할 때 더 만든다(월별·채널별 등, 회사마다 다르다).
//   · 흐름을 나타내는 상태 컬럼에는 settings.flow = true 를 준다 — 칸반이 이 컬럼을 열로 쓴다.
//
// 절대규칙: 순수 정의만 둔다(조회·side-effect 0). 화면과 시드가 이 파일만 본다.

import { addDaysStr } from "@/lib/kst";

//   partner = 거래처(검색 + 그 자리에서 신규 등록). 값은 partners.id 를 담는다.
export type ColType = "text" | "number" | "date" | "status" | "person" | "partner";

export type StatusOption = { id: string; label: string; color: string };
export type ColumnDef = { name: string; type: ColType; settings?: { options?: StatusOption[]; unit?: string; flow?: boolean;
  /** 광고 표 전용 — 이 칸에 어떤 지표를 채울지(AdMetricKey). 이름을 바꿔도 자리가 안 어긋난다 */
  ad?: string } };
export type GroupDef = { name: string; color: string };

/** 보는 방식. 원칙(2026-08-04 사장님 지시):
 *    · grid·board = **입력**하는 화면 — 기본값은 반드시 이 둘 중 하나다.
 *    · timeline·calendar = **읽는** 화면 — 정리한 결과를 보여줄 뿐 입력은 못 한다. 전환으로만 간다.
 *      (timeline = 기간을 본다 / calendar = 언제인지를 본다)
 *  "타임라인은 데이터를 정리해서 보여주는 거고 표가 입력화면이잖아? 입력화면이 기본값으로 나와야" */
export type InputMode = "grid" | "board" | "timeline" | "calendar" | "minutes" | "inbox" | "expiry" | "expense" | "deals";

/** 입력이 되는 보기인가 — 기본값 검증과 보기 줄 묶음에 같이 쓴다 */
export const INPUT_MODES: InputMode[] = ["grid", "board"];

/** 보기 이름 — 툴바 단추에 쓴다 */
export const MODE_LABEL: Record<InputMode, string> = {
  grid: "표", board: "칸반", timeline: "타임라인", calendar: "캘린더", minutes: "회의록", inbox: "접수함",
  expiry: "만기", expense: "지출 입력", deals: "건별",
};

/** 이 템플릿이 쓸 수 있는 입력 화면들 — **그 일의 첫 화면**이 맨 앞이다 (2026-08-07 사장님 지시:
 *  "템플릿이 다 똑같은 표라 실제 업무에 의미가 있는지 모르겠다").
 *  표·칸반은 없애지 않는다 — 익숙한 격자가 필요하면 언제든 돌아간다. */
export function inputModesOf(templateKey: string | null | undefined): InputMode[] {
  const first = findTemplate(templateKey || "").input;
  //   그 일 전용 화면(회의록 등)이 있으면 맨 앞에 세우고, 표·칸반은 뒤에 그대로 남긴다
  const special: InputMode[] = first && !INPUT_MODES.includes(first) ? [first] : [];
  return [...special, ...INPUT_MODES];
}

export type BoardTemplate = {
  key: string;
  name: string;
  /** 처음 열 때 보여줄 입력화면(2026-08-03 기획: 일의 형태별 최적화). 기본 grid */
  input?: InputMode;
  /** 무슨 일에 쓰는 표인지 — 고를 때 이게 이름보다 중요하다 */
  desc: string;
  uses: string;
  columns: ColumnDef[];
  groups: GroupDef[];
};

// 상태 색 — 기존 보드(monday-board)와 같은 팔레트를 쓴다(회사 안에서 색 의미가 갈리지 않게)
export const C = {
  gray: "#C4C4C4", blue: "#579BFC", indigo: "#5559DF", purple: "#A25DDC",
  orange: "#FDAB3D", green: "#00C875", red: "#E2445C", dark: "#333333",
};

const STATUS = (options: StatusOption[]): ColumnDef["settings"] => ({ options });
/** 흐름(단계) 상태 — 칸반이 이 컬럼을 열로 쓴다 */
const FLOW = (options: StatusOption[]): ColumnDef["settings"] => ({ options, flow: true });

/** 진행 상태 — 거의 모든 표가 쓰는 기본 상태 컬럼 */
const PROGRESS = STATUS([
  { id: "todo", label: "대기", color: C.gray },
  { id: "doing", label: "진행 중", color: C.orange },
  { id: "done", label: "완료", color: C.green },
  { id: "hold", label: "보류", color: C.red },
]);

export const BOARD_TEMPLATES: BoardTemplate[] = [
  {
    key: "todo",
    name: "할 일 · 진행",
    desc: "가장 단순한 표. 무엇을 누가 언제까지",
    uses: "실행 업무 · 오픈 준비 · 개선 과제 · 회의 후속조치",
    input: "board",
    columns: [
      { name: "상태", type: "status", settings: FLOW([
        { id: "todo", label: "할 일", color: C.indigo },
        { id: "doing", label: "진행 중", color: C.orange },
        { id: "done", label: "완료", color: C.green },
      ]) },
      { name: "담당", type: "person" },
      { name: "마감", type: "date" },
      { name: "우선순위", type: "status", settings: STATUS([
        { id: "high", label: "높음", color: C.red },
        { id: "mid", label: "보통", color: C.indigo },
        { id: "low", label: "낮음", color: C.blue },
      ]) },
    ],
    groups: [{ name: "할 일 목록", color: C.indigo }],
  },
  {
    //   예산 · 지출 — '비용 · 지출' 과 '집행 · 성과' 를 하나로 합쳤다 (2026-08-07 사장님 지시).
    //   두 표는 칸 구조가 사실상 같았다(계획 금액 / 실제 금액 + 자동 비율 칸). 그래서 화면이
    //   "같은 지출이 두 번 잡힌 것 같아요" 경고를 띄우고 있었다 — 경고가 필요하다는 건
    //   설계가 겹친다는 신호다. 예산을 잡고 실제로 쓰는 일은 원래 한 흐름이다.
    //   ('성과' 숫자 칸은 뺐다 — 단위가 없어 무엇을 재는지 알 수 없었다. 필요하면 칸을 붙인다.)
    key: "spend",
    name: "예산 · 지출",
    desc: "쓸 돈을 잡고, 실제로 쓴 돈을 확정",
    uses: "외주비 · 구매 · 사무실 이전 · 마케팅 집행 · 정부지원사업 정산 · 정기 지출",
    //   쓴 돈을 적는 일이다 — 예산 게이지를 위에 두고 한 줄에서 적는다(2026-08-07)
    input: "expense",
    columns: [
      { name: "구분", type: "status", settings: STATUS([
        { id: "outsource", label: "외주", color: C.purple },
        { id: "buy", label: "구매", color: C.indigo },
        { id: "ad", label: "광고", color: C.orange },
        { id: "fixed", label: "고정비", color: C.blue },
        { id: "etc", label: "기타", color: C.gray },
      ]) },
      { name: "거래처", type: "partner" },
      { name: "예산", type: "number", settings: { unit: "원" } },
      { name: "집행", type: "number", settings: { unit: "원" } },
      { name: "결제일", type: "date" },
      { name: "담당", type: "person" },
      { name: "상태", type: "status", settings: PROGRESS },
    ],
    groups: [{ name: "지출 목록", color: C.indigo }],
  },
  {
    //   매출 흐름 — '수주 · 매출' 과 '매출 · 청구' 를 하나로 합쳤다 (2026-08-07 사장님 지시).
    //   두 표는 정리 탭의 **같은 '받을 돈' 축**에 합산됐다. 그래서 수주에서 계약된 건을 청구 표로
    //   옮겨 적으면 같은 돈이 두 번 잡혔다(옮기는 동선조차 없어 손으로 다시 적어야 했다).
    //   한 줄(검토 → 제안 → 계약 → 발행 → 입금)로 두니 옮겨 적을 일도 이중 계상도 사라진다.
    //   '확률' 은 두지 않는다 (2026-08-07 사장님: 필요 없다). 대신 **입금** 칸을 둬서
    //   계약금이 들어온 뒤 잔금이 얼마인지 그 줄에서 바로 보이게 한다 — 금액과 입금이
    //   같은 단위(원)라 표가 '입금률'과 '남은 금액'을 자동으로 그려 준다.
    key: "revenue",
    name: "매출 흐름",
    desc: "받을 돈을 검토 → 제안 → 계약 → 발행 → 입금 한 줄로",
    uses: "영업 파이프라인 · 견적 · 수주 · 프로젝트 매출 · 청구 · 수금 · 기성",
    //   여러 건을 채울 땐 표가 빠르지만, 한 건을 끝까지 끌고 갈 땐 서류·입금이 흩어져 보인다.
    //   첫 화면은 건별 진행 카드로 두고 표는 보기 줄에 남긴다(2026-08-07).
    input: "deals",
    columns: [
      { name: "단계", type: "status", settings: FLOW([
        { id: "review", label: "검토", color: C.gray },
        { id: "proposal", label: "제안", color: C.indigo },
        { id: "contract", label: "계약", color: C.blue },
        { id: "issued", label: "발행", color: C.purple },
        { id: "paid", label: "입금", color: C.green },
      ]) },
      { name: "거래처", type: "partner" },
      { name: "금액", type: "number", settings: { unit: "원" } },
      { name: "입금", type: "number", settings: { unit: "원" } },
      { name: "예정일", type: "date" },
      { name: "담당", type: "person" },
      { name: "비고", type: "text" },
    ],
    // 이 템플릿의 행에서는 견적서·계약서를 바로 만든다(ProjectBoards 의 문서 셀).
    groups: [{ name: "매출 목록", color: C.indigo }],
  },
  {
    key: "review",
    name: "요청 · 검수",
    desc: "누가 요청하고 누가 확인하는 흐름",
    uses: "디자인 시안 · 문서 검토 · 고객 요청 처리 · 하자·A/S · 인허가 서류",
    //   요청은 넣고 받는 일이다 — 첫 화면은 접수함(칸반·표는 보기 줄에 그대로 남는다)
    input: "inbox",
    columns: [
      { name: "상태", type: "status", settings: FLOW([
        { id: "req", label: "요청", color: C.gray },
        { id: "doing", label: "작업 중", color: C.orange },
        { id: "check", label: "검수", color: C.purple },
        { id: "done", label: "완료", color: C.green },
      ]) },
      { name: "요청자", type: "person" },
      { name: "담당", type: "person" },
      { name: "기한", type: "date" },
      { name: "링크", type: "text" },
    ],
    groups: [{ name: "요청 목록", color: C.indigo }],
  },
  {
    key: "schedule",
    name: "일정 · 마일스톤",
    desc: "기간이 있는 일",
    uses: "시공·설치 · 오픈 준비 · 행사 진행 · 개발 일정 · 계약 이행",
    //   기간을 잡는 일이다 — 달력에서 끌어 만든다(표는 보기 줄에 그대로 남는다, 2026-08-07)
    input: "calendar",
    columns: [
      { name: "시작", type: "date" },
      { name: "종료", type: "date" },
      { name: "담당", type: "person" },
      { name: "상태", type: "status", settings: PROGRESS },
    ],
    groups: [{ name: "일정", color: C.indigo }],
  },
  {
    //   회의 · 결정 — 지금까지는 '할 일' 표에 억지로 적고 있었다 (2026-08-07 신설).
    //   한 줄이 **안건 하나**다. 회의 회차는 그룹으로 나눈다(＋ 그룹 추가 → '8/7 주간회의').
    //   결정만 적고 끝내지 않게 담당·기한을 같은 줄에 둔다 — 후속조치가 곧 다음 할 일이다.
    key: "meeting",
    name: "회의 · 결정",
    desc: "정한 것과 다음에 할 일을 한 줄에",
    uses: "주간회의 · 킥오프 · 고객 미팅 · 이사회 · 현장 점검 회의",
    //   회의록은 격자가 아니라 문서다 — 첫 화면을 회의록으로 연다(표로 언제든 돌아간다)
    input: "minutes",
    columns: [
      { name: "상태", type: "status", settings: FLOW([
        { id: "open", label: "논의 중", color: C.gray },
        { id: "decided", label: "결정", color: C.indigo },
        { id: "hold", label: "보류", color: C.red },
        { id: "done", label: "완료", color: C.green },
      ]) },
      { name: "회의일", type: "date" },
      { name: "결정 내용", type: "text" },
      { name: "담당", type: "person" },
      { name: "기한", type: "date" },
    ],
    groups: [{ name: "이번 회의", color: C.indigo }],
  },
  {
    //   계약 · 갱신 — 만기를 놓치는 게 이 일의 진짜 위험이다 (2026-08-07 신설).
    //   '만기' 가 기한 칸이라 정리 탭이 '주별 만기'와 '기한 지난 건' 을 저절로 뽑아 준다.
    //   ⚠️ 계약금액은 참고용이다 — 받을 돈은 '매출 흐름' 이 센다. 여기 금액을 또 더하면
    //      같은 돈을 두 번 잡는다(그래서 이 표는 돈 집계에 넣지 않는다).
    key: "contract",
    name: "계약 · 갱신",
    desc: "언제 끝나고 언제 다시 맺나",
    uses: "임대차 · 유지보수 · 구독 · 용역 계약 · 라이선스 · 보험",
    //   이 일의 위험은 만기를 놓치는 것 하나다 — 첫 화면은 만기순 카드(2026-08-07)
    input: "expiry",
    columns: [
      { name: "상태", type: "status", settings: FLOW([
        { id: "review", label: "검토", color: C.gray },
        { id: "signed", label: "체결", color: C.indigo },
        { id: "running", label: "이행 중", color: C.blue },
        { id: "renew", label: "갱신 예정", color: C.orange },
        { id: "closed", label: "종료", color: C.green },
      ]) },
      { name: "거래처", type: "partner" },
      { name: "계약금액", type: "number", settings: { unit: "원" } },
      { name: "시작", type: "date" },
      { name: "만기", type: "date" },
      { name: "담당", type: "person" },
      { name: "비고", type: "text" },
    ],
    groups: [{ name: "계약 목록", color: C.indigo }],
  },
  {
    //   마케팅 계정 관리 — 값은 사람이 아니라 매체 API 가 채운다(2026-08-06 사장님 지시).
    //   행 하나가 캠페인 하나. 회사 금고에 등록한 광고 계정을 이 프로젝트에 연결하면 채워진다.
    key: "ads",
    name: "마케팅 계정 관리",
    desc: "광고 계정을 연결하면 캠페인 성과가 저절로 채워집니다",
    uses: "네이버 검색광고 · 대행 클라이언트 광고 운영 · 매체별 성과 정리",
    input: "grid",
    columns: [
      { name: "매체", type: "status", settings: { ad: "platform", options: [
        { id: "naver_sa", label: "네이버 검색", color: C.green },
        { id: "naver_gfa", label: "네이버 GFA", color: C.blue },
        { id: "google_ads", label: "구글", color: C.orange },
        { id: "meta_ads", label: "메타", color: C.indigo },
      ] } },
      { name: "노출", type: "number", settings: { ad: "impressions", unit: "회" } },
      { name: "클릭", type: "number", settings: { ad: "clicks", unit: "회" } },
      { name: "클릭률", type: "number", settings: { ad: "ctr", unit: "%" } },
      { name: "광고비", type: "number", settings: { ad: "cost", unit: "원" } },
      { name: "전환", type: "number", settings: { ad: "conversions", unit: "건" } },
      { name: "전환당 비용", type: "number", settings: { ad: "cpa", unit: "원" } },
      { name: "메모", type: "text" },
    ],
    groups: [{ name: "캠페인", color: C.indigo }],
  },
];

/** 칸의 형식 — 고를 때 보이는 이름과 무엇에 쓰는 칸인지.
 *  템플릿 직접 만들기와 표 머리의 ＋ 가 **같은 목록**을 본다(두 곳에서 말이 갈리면 안 된다). */
export const COL_FORMATS: { type: ColType; label: string; hint: string }[] = [
  { type: "text", label: "텍스트", hint: "메모 · 링크 · 자유롭게 적는 칸" },
  { type: "number", label: "숫자", hint: "금액 · 수량 — 단위를 정할 수 있어요" },
  { type: "date", label: "날짜", hint: "마감 · 시작 · 예정일" },
  { type: "status", label: "상태", hint: "라벨 중에서 고르는 칸" },
  { type: "person", label: "담당자", hint: "회사 구성원 중에서" },
  { type: "partner", label: "거래처", hint: "거래처를 찾거나 그 자리에서 등록" },
];

/** 상태 칸을 새로 만들 때 딸려 오는 기본 라벨 — 그대로 쓰든 고쳐 쓰든 */
export const DEFAULT_STATUS_OPTIONS: StatusOption[] = [
  { id: "todo", label: "대기", color: C.gray },
  { id: "doing", label: "진행 중", color: C.orange },
  { id: "done", label: "완료", color: C.green },
];

// ── 마케팅(광고) 표 — 값은 사람이 아니라 매체 API 가 채운다 (2026-08-06 사장님 지시) ──
//   ⚠️ 어느 칸에 무엇을 채울지는 **이름이 아니라 settings.ad 로** 정한다.
//      사장님이 칸 이름을 바꿔도(예: '비용' → '광고비') 채우는 자리가 어긋나지 않게.
export type AdMetricKey = "impressions" | "clicks" | "ctr" | "cost" | "conversions" | "cpa" | "roas" | "platform";
/** 이 행이 어느 캠페인인지 — 칸이 아니라 예약 키로 값에 담는다(칸을 지워도 연결이 안 끊기게) */
export const AD_VALUE_KEY = "__ad";
export type AdRowLink = { accountId: string; campaignId: string };

export const AD_TEMPLATE_KEY = "ads";
/** 자동으로 채우는 칸 — 사람이 고쳐도 다음 수집 때 덮어써지므로 화면에서 잠근다 */
export const AD_AUTO_KEYS: AdMetricKey[] = ["impressions", "clicks", "ctr", "cost", "conversions", "cpa", "roas", "platform"];
export function adMetricOf(col: { settings?: any }): AdMetricKey | null {
  const k = col?.settings?.ad;
  return AD_AUTO_KEYS.includes(k) ? (k as AdMetricKey) : null;
}

/** 라벨 색 — 회사 안에서 색 뜻이 갈리지 않게 이 여덟 가지만 쓴다 */
export const LABEL_COLORS = [C.gray, C.blue, C.indigo, C.purple, C.orange, C.green, C.red, C.dark];

/** 한 칸 안에서 안 겹치는 라벨 id */
export function newOptionId(existing: { id: string }[]): string {
  const used = new Set(existing.map((o) => o.id));
  for (let i = 1; i < 999; i++) if (!used.has(`o${i}`)) return `o${i}`;
  return `o${existing.length + 1}`;
}

/** 템플릿 미리보기용 예시 줄 — 고르는 사람이 "이게 무슨 표인지"를 글보다 빨리 안다
 *  (2026-08-07 사장님 지시: 마우스를 올리면 어떤 형태인지 예시로 보여줄 것).
 *
 *  ⚠️ 값은 **칸 차례 그대로**다: [행 이름, ...columns 순서]. 칸을 고치면 여기도 같이 고친다.
 *     상태 칸의 값은 그 템플릿에 정의된 **라벨과 똑같이** 적는다 — 미리보기가 그 색을 찾아 쓴다.
 *     실제 회사에서 볼 법한 값으로 적는다(빈 칸 예시는 아무것도 알려 주지 않는다). */
export const TEMPLATE_SAMPLE: Record<string, string[][]> = {
  todo: [
    ["브랜드 로고 시안 3종", "진행 중", "김혜진", "8/12", "높음"],
    ["상세 페이지 검수", "할 일", "남기원", "8/14", "보통"],
    ["오픈 체크리스트 정리", "완료", "최송이", "8/6", "낮음"],
  ],
  spend: [
    ["브랜드 촬영 외주", "외주", "스튜디오 오름", "5,000,000", "4,500,000", "8/25", "이경원", "진행 중"],
    ["네이버 검색광고", "광고", "네이버", "3,000,000", "2,780,000", "8/31", "최송이", "완료"],
    ["사무실 임대료", "고정비", "제일산업", "2,200,000", "2,200,000", "8/10", "회계담당자", "완료"],
  ],
  revenue: [
    ["브랜드몰 구축 1차", "계약", "(주)카카오", "12,000,000", "4,000,000", "9/5", "이경원", "착수금 40%"],
    ["리뉴얼 제안", "제안", "만들다", "8,000,000", "", "9/20", "연준호", ""],
    ["유지보수 8월", "입금", "유앤아이", "1,500,000", "1,500,000", "8/5", "이경원", ""],
  ],
  review: [
    ["메인 배너 시안", "검수", "최송이", "김혜진", "8/9", "figma.com/…"],
    ["계약서 문구 검토", "작업 중", "이경원", "회계담당자", "8/11", ""],
    ["A/S 접수 — 도어락", "요청", "남기원", "권순철", "8/13", ""],
  ],
  schedule: [
    ["철거·원상복구", "8/1", "8/9", "권순철", "완료"],
    ["인테리어 공사", "8/10", "8/28", "남기원", "진행 중"],
    ["집기 반입·세팅", "8/29", "9/2", "최송이", "대기"],
  ],
  meeting: [
    ["브랜드몰 오픈일 확정", "결정", "8/7", "9/15 오픈 · 사전예약 8/25", "이경원", "8/25"],
    ["촬영 스튜디오 재선정", "논의 중", "8/7", "견적 3곳 비교 후 재논의", "김혜진", "8/12"],
    ["배송비 정책", "보류", "8/7", "물류사 회신 후 결정", "남기원", ""],
  ],
  contract: [
    ["본사 사무실 임대차", "이행 중", "제일산업", "36,000,000", "2026-03-01", "2027-02-28", "회계담당자", "자동갱신"],
    ["그룹웨어 구독", "갱신 예정", "(주)카카오", "1,200,000", "2025-09-01", "2026-08-31", "이경원", "연 단위"],
    ["보안 유지보수", "체결", "유앤아이", "4,800,000", "2026-08-01", "2027-07-31", "권순철", ""],
  ],
  //   광고 표는 사람이 채우지 않는다 — 미리보기도 표가 아니라 대시보드 모양으로 보여 준다
  ads: [],
};

/** 빈 표 — 템플릿을 안 고르고 시작할 때. 최소한의 뼈대만 준다. */
export const BLANK_TEMPLATE: BoardTemplate = {
  key: "blank",
  name: "빈 템플릿",
  desc: "컬럼을 직접 만들어 씁니다",
  uses: "위 형태에 안 맞는 일",
  columns: [
    { name: "담당", type: "person" },
    { name: "상태", type: "status", settings: PROGRESS },
  ],
  groups: [{ name: "그룹 1", color: C.indigo }],
};

/** '매출 · 청구' 행에 붙는 문서 연결 — 컬럼이 아니라 예약 키로 값에 담는다
 *  (사용자가 컬럼을 지워도 연결이 끊기지 않게). 각각 { id, no } */
export const DOC_VALUE_KEY = "__quote";
export const CONTRACT_VALUE_KEY = "__contract";

/** 계약서의 결제조건 한 회차 — documents.content_json.paymentSchedule 의 원소 */
export type PayTermRow = { label: string; ratio?: number; amount?: number; condition?: string };

/** 계약서에서 결제조건을 꺼낸다. 회차가 없으면 빈 배열. */
export function payTermsOf(contract: any): PayTermRow[] {
  const arr = (contract?.content_json as any)?.paymentSchedule;
  if (!Array.isArray(arr)) return [];
  return arr.filter((x: any) => x && x.label).map((x: any) => ({
    label: String(x.label), ratio: Number(x.ratio) || undefined,
    amount: Number(x.amount) || undefined, condition: x.condition ? String(x.condition) : undefined,
  }));
}

export function findTemplate(key: string | null | undefined): BoardTemplate {
  return BOARD_TEMPLATES.find((t) => t.key === key) || BLANK_TEMPLATE;
}

/** 첫 컬럼(행 이름)은 표마다 이름이 다르다 — 템플릿별 라벨 */
export const ITEM_LABEL: Record<string, string> = {
  todo: "작업", spend: "항목", revenue: "매출 건", review: "요청", schedule: "일정", blank: "이름",
  meeting: "안건", contract: "계약",
  ads: "캠페인",
  custom: "이름",
  //   합치기 전 템플릿 — 목록에서는 사라졌지만 이미 만들어 쓰는 표가 있으므로 말은 그대로 둔다
  budget: "항목", cost: "항목", billing: "청구 건", pipeline: "건명",
};

/** 합치기 전 키 → 합친 뒤 키. 돈 집계·정리처럼 '성격'으로 갈라 보는 곳이 이걸 통해 읽는다.
 *  (2026-08-07) 이미 만들어 쓰는 표를 강제로 바꾸지 않는다 — 같은 성격으로 읽어 주기만 한다. */
const TEMPLATE_KIND: Record<string, string> = {
  billing: "revenue", pipeline: "revenue", revenue: "revenue",
  cost: "spend", budget: "spend", spend: "spend",
};
/** 이 표가 어떤 성격인지 — 합치기 전 키도 합친 뒤 이름으로 답한다 */
export const templateKind = (key: string | null | undefined) => TEMPLATE_KIND[String(key || "")] || String(key || "");

export type BoardColumn = { id: string; board_id: string; name: string; type: ColType; settings: any; position: number };
export type BoardGroup = { id: string; board_id: string; name: string; color: string; position: number };
export type BoardItem = { id: string; board_id: string; group_id: string | null; parent_item_id: string | null; name: string; values: Record<string, any>; position: number };

/** 숫자 컬럼 합계 — 그룹 바닥줄과 정리 탭이 같이 쓴다 */
export function sumColumn(items: BoardItem[], colId: string): number {
  return items.reduce((n, it) => n + (Number(it.values?.[colId]) || 0), 0);
}

// ── 정리(요약) — 컬럼 타입만 보고 만든다(2026-08-03 기획 v2 4단계) ──
//   템플릿을 새로 만들어도 이 함수는 그대로다. 값이 없는 항목은 만들지 않는다.
//
// 시연 데이터를 6종 템플릿에 다 넣어 보고 고친 것 3가지(2026-08-03):
//   ① 끝난 행을 '기한 지남'으로 계속 세고 있었다 → 완료 행은 날짜 집계에서 뺀다.
//   ② '시작' 날짜가 과거인 걸 지연으로 셌다 → 시작일은 기한이 아니다(이미 시작했다는 뜻).
//   ③ 단위가 다른 숫자 둘을 뺐다 ('수주·매출'에서 금액(원) − 확률(%)) → 단위가 같을 때만 뺀다.

/** 끝난 것으로 볼 말 — 그룹 이름과 상태 옵션 라벨에 같이 쓴다 */
export const DONE_WORD_RE = /완료|종료|계약|승인|마감됨|입금|수금/;

/** 상태 컬럼의 종착 옵션 — 여러 개가 걸리면 **마지막** 것이 종착지다
 *  ('매출 · 청구' 의 견적·계약·발행·입금 에서는 '계약' 이 아니라 '입금' 이 끝이다) */
export function terminalOptionId(col: { settings?: any }): string | null {
  const options: any[] = col?.settings?.options || [];
  for (let i = options.length - 1; i >= 0; i--) {
    if (DONE_WORD_RE.test(String(options[i].label))) return String(options[i].id);
  }
  return null;
}

/** 간트가 쓸 기간 컬럼 — '시작' 계열이 왼쪽, 나머지 날짜 컬럼 중 첫 번째가 오른쪽.
 *  시작이 없으면 날짜 컬럼 하나를 점(하루)으로 찍는다. 날짜가 없으면 null. */
export function spanColumnsOf<T extends { type: string; name: string }>(cols: T[]): { start: T; end: T } | null {
  const dates = cols.filter((c) => c.type === "date");
  if (dates.length === 0) return null;
  const start = dates.find((c) => START_DATE_RE.test(c.name)) || dates[0];
  const end = dates.find((c) => c !== start) || start;
  return { start, end };
}

/** 칸반이 열로 쓸 컬럼 — 흐름 표시(flow)가 붙은 상태 컬럼, 없으면 첫 상태 컬럼 */
export function flowColumnOf<T extends { type: string; settings?: any }>(cols: T[]): T | null {
  return cols.find((c) => c.type === "status" && c.settings?.flow)
    || cols.find((c) => c.type === "status")
    || null;
}
/** 기한이 아닌 날짜 컬럼 — 시작일이 과거인 건 정상이다 */
export const START_DATE_RE = /시작|착수|개시|접수일/;

/** 이 행은 끝났나 — 상태 컬럼의 완료 옵션이 골라졌거나, 완료류 그룹에 있으면 끝난 것 */
export function isDoneRow(
  it: { group_id: string | null; values: Record<string, any> },
  cols: { id: string; type: string; settings?: any }[],
  groups: { id: string; name: string }[],
): boolean {
  const g = groups.find((x) => x.id === it.group_id);
  if (g && DONE_WORD_RE.test(g.name)) return true;
  return cols.some((c) => {
    if (c.type !== "status") return false;
    const term = terminalOptionId(c);
    return !!term && it.values?.[c.id] === term;
  });
}
export type SummaryCard =
  //   mode="avg" 는 더하면 안 되는 값(확률 %, 달성률 등) — 합계 대신 평균을 크게 보여준다
  | { kind: "number"; label: string; sum: number; avg: number; filled: number; unit: string; mode: "sum" | "avg" }
  //   가중 금액 — 금액(원) × 확률(%). 수주 파이프라인에서 대표가 실제로 보는 숫자다
  | { kind: "weighted"; label: string; value: number; a: string; b: string }
  | { kind: "diff"; label: string; value: number; a: string; b: string; unit: string }
  | { kind: "status"; label: string; parts: { label: string; color: string; count: number }[]; doneRate: number | null }
  | { kind: "date"; label: string; soon: number; late: number; next: string | null }
  | { kind: "person"; label: string; rows: { name: string; count: number }[] }
  | { kind: "group"; label: string; parts: { label: string; color: string; count: number }[] };

const isFilled = (v: any) => v !== null && v !== undefined && v !== "";

export function buildBoardSummary(
  cols: BoardColumn[], items: BoardItem[], groups: BoardGroup[],
  nameOf: (userId: string) => string, today: string,
): SummaryCard[] {
  const cards: SummaryCard[] = [];
  if (items.length === 0) return cards;

  // 그룹이 여럿이면 그룹 분포가 곧 진행 상태다(할 일·수주·요청 템플릿)
  if (groups.length > 1) {
    const parts = groups.map((g) => ({
      label: g.name, color: g.color, count: items.filter((it) => it.group_id === g.id).length,
    })).filter((p) => p.count > 0);
    if (parts.length > 0) cards.push({ kind: "group", label: "그룹별 행 수", parts });
  }

  const numberCols = cols.filter((c) => c.type === "number");
  for (const c of numberCols) {
    const vals = items.map((it) => Number(it.values?.[c.id])).filter((n) => Number.isFinite(n) && n !== 0);
    if (vals.length === 0) continue;
    const sum = vals.reduce((a, b) => a + b, 0);
    // % 는 더하면 뜻이 없다(확률 370% 같은 카드가 떴었다) — 평균을 크게 보여준다
    const mode = (c.settings?.unit || "") === "%" ? "avg" : "sum";
    cards.push({ kind: "number", label: c.name, sum, avg: Math.round(sum / vals.length), filled: vals.length, unit: c.settings?.unit || "", mode });
  }
  // 금액(원) × 확률(%) — 둘 다 있으면 가중 합계. '수주 · 매출' 에서 실제로 쓰는 숫자다.
  const moneyCol = numberCols.find((c) => (c.settings?.unit || "") === "원");
  const pctCol = numberCols.find((c) => (c.settings?.unit || "") === "%");
  if (moneyCol && pctCol) {
    const w = items.reduce((n, it) => {
      const amt = Number(it.values?.[moneyCol.id]) || 0;
      const pct = Number(it.values?.[pctCol.id]);
      return n + (Number.isFinite(pct) ? amt * (pct / 100) : 0);
    }, 0);
    if (w > 0) cards.push({ kind: "weighted", label: `확률 반영 ${moneyCol.name}`, value: Math.round(w), a: moneyCol.name, b: pctCol.name });
  }
  // 숫자 컬럼이 둘이면 차이도 준다(예산−집행 = 잔여 / 예상−확정).
  //   단위가 같을 때만 — '수주·매출'의 금액(원) − 확률(%) 같은 카드가 뜨면 안 된다.
  if (numberCols.length >= 2) {
    const [a, b] = numberCols;
    const sa = sumColumn(items, a.id), sb = sumColumn(items, b.id);
    if ((a.settings?.unit || "") === (b.settings?.unit || "") && (sa !== 0 || sb !== 0)) {
      cards.push({ kind: "diff", label: `${a.name} − ${b.name}`, value: sa - sb, a: a.name, b: b.name, unit: a.settings?.unit || "" });
    }
  }

  for (const c of cols.filter((x) => x.type === "status")) {
    const options: any[] = c.settings?.options || [];
    const parts = options.map((o) => ({
      label: o.label, color: o.color, count: items.filter((it) => it.values?.[c.id] === o.id).length,
    })).filter((p) => p.count > 0);
    if (parts.length === 0) continue;
    const term = terminalOptionId(c);
    const doneCount = term ? items.filter((it) => it.values?.[c.id] === term).length : 0;
    const total = parts.reduce((n, p) => n + p.count, 0);
    cards.push({ kind: "status", label: c.name, parts, doneRate: term && total > 0 ? Math.round((doneCount / total) * 100) : null });
  }

  // 날짜 — 끝난 행은 빼고 센다(끝난 일의 지난 마감은 지연이 아니다).
  //   '시작' 계열 컬럼은 지남/임박을 매기지 않는다 — 다만 있으면 '다음' 은 알려준다.
  const openItems = items.filter((it) => !isDoneRow(it, cols as any, groups as any));
  for (const c of cols.filter((x) => x.type === "date")) {
    const isDue = !START_DATE_RE.test(c.name);
    const pick = (rows: BoardItem[]) => rows.map((it) => String(it.values?.[c.id] || "")).filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d));
    const all = pick(items);
    if (all.length === 0) continue;
    const open = pick(openItems);
    const week = addDaysStr(today, 7);
    const late = isDue ? open.filter((d) => d < today).length : 0;
    const soon = isDue ? open.filter((d) => d >= today && d <= week).length : 0;
    const next = open.filter((d) => d >= today).sort()[0] || null;
    cards.push({ kind: "date", label: c.name, soon, late, next });
  }

  for (const c of cols.filter((x) => x.type === "person")) {
    const m: Record<string, number> = {};
    for (const it of items) {
      const v = it.values?.[c.id];
      if (!isFilled(v)) continue;
      m[v] = (m[v] || 0) + 1;
    }
    const rows = Object.entries(m).map(([id, count]) => ({ name: nameOf(id) || "이름 없음", count }))
      .sort((x, y) => y.count - x.count).slice(0, 5);
    if (rows.length > 0) cards.push({ kind: "person", label: c.name, rows });
  }

  return cards;
}
