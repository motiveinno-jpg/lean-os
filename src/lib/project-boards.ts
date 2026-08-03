// 프로젝트 표(보드) — 새 프로젝트 구조의 뼈대 (2026-08-03 기획 v2, 사장님 승인).
//
//   프로젝트 1 : N 표 : N 그룹 : N 행.  값은 행의 jsonb 한 칸(컬럼ID → 값)에 담는다.
//   컬럼을 더해도 DB 구조를 바꾸지 않는다.
//
// 템플릿은 **부서가 아니라 일의 형태**로 나눈다 — 같은 표가 여러 업무를 덮는다.
//   예: '집행 · 성과' 하나가 마케팅 캠페인 · 광고 · 전시회 · 교육 · 지원사업 집행에 다 쓰인다.
//
// 절대규칙: 순수 정의만 둔다(조회·side-effect 0). 화면과 시드가 이 파일만 본다.

export type ColType = "text" | "number" | "date" | "status" | "person";

export type StatusOption = { id: string; label: string; color: string };
export type ColumnDef = { name: string; type: ColType; settings?: { options?: StatusOption[]; unit?: string } };
export type GroupDef = { name: string; color: string };

export type BoardTemplate = {
  key: string;
  name: string;
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
    columns: [
      { name: "담당", type: "person" },
      { name: "마감", type: "date" },
      { name: "우선순위", type: "status", settings: STATUS([
        { id: "high", label: "높음", color: C.red },
        { id: "mid", label: "보통", color: C.indigo },
        { id: "low", label: "낮음", color: C.blue },
      ]) },
      { name: "상태", type: "status", settings: PROGRESS },
    ],
    groups: [{ name: "할 일", color: C.indigo }, { name: "진행 중", color: C.orange }, { name: "완료", color: C.green }],
  },
  {
    key: "budget",
    name: "집행 · 성과",
    desc: "예산을 쓰고 결과를 재는 일",
    uses: "마케팅 캠페인 · 광고 집행 · 전시회 참가 · 교육/행사 · 정부지원사업 집행",
    columns: [
      { name: "구분", type: "status", settings: STATUS([
        { id: "online", label: "온라인", color: C.indigo },
        { id: "offline", label: "오프라인", color: C.purple },
        { id: "etc", label: "기타", color: C.gray },
      ]) },
      { name: "담당", type: "person" },
      { name: "시작", type: "date" },
      { name: "종료", type: "date" },
      { name: "예산", type: "number", settings: { unit: "원" } },
      { name: "집행", type: "number", settings: { unit: "원" } },
      { name: "성과", type: "number" },
      { name: "상태", type: "status", settings: PROGRESS },
    ],
    groups: [{ name: "준비", color: C.indigo }, { name: "집행 중", color: C.orange }, { name: "종료", color: C.green }],
  },
  {
    key: "cost",
    name: "비용 · 지출",
    desc: "나갈 돈을 예상하고 확정",
    uses: "외주비 · 구매 · 사무실 이전 · 사업비 정산 · 정기 지출",
    columns: [
      { name: "구분", type: "status", settings: STATUS([
        { id: "outsource", label: "외주", color: C.purple },
        { id: "buy", label: "구매", color: C.indigo },
        { id: "fixed", label: "고정비", color: C.blue },
        { id: "etc", label: "기타", color: C.gray },
      ]) },
      { name: "거래처", type: "text" },
      { name: "예상", type: "number", settings: { unit: "원" } },
      { name: "확정", type: "number", settings: { unit: "원" } },
      { name: "결제일", type: "date" },
      { name: "상태", type: "status", settings: PROGRESS },
    ],
    groups: [{ name: "예정", color: C.indigo }, { name: "집행", color: C.orange }, { name: "완료", color: C.green }],
  },
  {
    key: "pipeline",
    name: "수주 · 매출",
    desc: "들어올 돈을 단계로 관리",
    uses: "영업 파이프라인 · 견적 · 입찰 · 재계약 · 제휴 제안",
    columns: [
      { name: "거래처", type: "text" },
      { name: "금액", type: "number", settings: { unit: "원" } },
      { name: "확률", type: "number", settings: { unit: "%" } },
      { name: "예상일", type: "date" },
      { name: "담당", type: "person" },
      { name: "단계", type: "status", settings: STATUS([
        { id: "lead", label: "검토", color: C.gray },
        { id: "quote", label: "제안", color: C.indigo },
        { id: "won", label: "계약", color: C.green },
        { id: "lost", label: "무산", color: C.red },
      ]) },
    ],
    groups: [{ name: "검토", color: C.gray }, { name: "제안", color: C.indigo }, { name: "계약", color: C.green }],
  },
  {
    key: "review",
    name: "요청 · 검수",
    desc: "누가 요청하고 누가 확인하는 흐름",
    uses: "디자인 시안 · 문서 검토 · 고객 요청 처리 · 하자·A/S · 인허가 서류",
    columns: [
      { name: "요청자", type: "person" },
      { name: "담당", type: "person" },
      { name: "기한", type: "date" },
      { name: "상태", type: "status", settings: STATUS([
        { id: "req", label: "요청", color: C.gray },
        { id: "work", label: "작업 중", color: C.orange },
        { id: "review", label: "검수", color: C.purple },
        { id: "done", label: "완료", color: C.green },
      ]) },
      { name: "링크", type: "text" },
    ],
    groups: [{ name: "요청", color: C.gray }, { name: "작업 중", color: C.orange }, { name: "검수", color: C.purple }, { name: "완료", color: C.green }],
  },
  {
    key: "schedule",
    name: "일정 · 마일스톤",
    desc: "기간이 있는 일",
    uses: "시공·설치 · 오픈 준비 · 행사 진행 · 개발 일정 · 계약 이행",
    columns: [
      { name: "시작", type: "date" },
      { name: "종료", type: "date" },
      { name: "담당", type: "person" },
      { name: "상태", type: "status", settings: PROGRESS },
    ],
    groups: [{ name: "예정", color: C.indigo }, { name: "진행", color: C.orange }, { name: "완료", color: C.green }],
  },
];

/** 빈 표 — 템플릿을 안 고르고 시작할 때. 최소한의 뼈대만 준다. */
export const BLANK_TEMPLATE: BoardTemplate = {
  key: "blank",
  name: "빈 표",
  desc: "컬럼을 직접 만들어 씁니다",
  uses: "위 형태에 안 맞는 일",
  columns: [
    { name: "담당", type: "person" },
    { name: "상태", type: "status", settings: PROGRESS },
  ],
  groups: [{ name: "그룹 1", color: C.indigo }],
};

export function findTemplate(key: string | null | undefined): BoardTemplate {
  return BOARD_TEMPLATES.find((t) => t.key === key) || BLANK_TEMPLATE;
}

/** 첫 컬럼(행 이름)은 표마다 이름이 다르다 — 템플릿별 라벨 */
export const ITEM_LABEL: Record<string, string> = {
  todo: "작업", budget: "항목", cost: "항목", pipeline: "건명", review: "요청", schedule: "이름", blank: "이름",
};

export type BoardColumn = { id: string; board_id: string; name: string; type: ColType; settings: any; position: number };
export type BoardGroup = { id: string; board_id: string; name: string; color: string; position: number };
export type BoardItem = { id: string; board_id: string; group_id: string | null; parent_item_id: string | null; name: string; values: Record<string, any>; position: number };

/** 숫자 컬럼 합계 — 그룹 바닥줄과 정리 탭이 같이 쓴다 */
export function sumColumn(items: BoardItem[], colId: string): number {
  return items.reduce((n, it) => n + (Number(it.values?.[colId]) || 0), 0);
}
