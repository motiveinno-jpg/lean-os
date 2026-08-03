// 프로젝트 표(보드) — 새 프로젝트 구조의 뼈대 (2026-08-03 기획 v2, 사장님 승인).
//
//   프로젝트 1 : N 표 : N 그룹 : N 행.  값은 행의 jsonb 한 칸(컬럼ID → 값)에 담는다.
//   컬럼을 더해도 DB 구조를 바꾸지 않는다.
//
// 템플릿은 **부서가 아니라 일의 형태**로 나눈다 — 같은 표가 여러 업무를 덮는다.
//   예: '집행 · 성과' 하나가 마케팅 캠페인 · 광고 · 전시회 · 교육 · 지원사업 집행에 다 쓰인다.
//
// 그룹 원칙 (2026-08-03 사장님: "템플릿마다 준비·집행중·종료가 똑같이 들어갈 필요는 없다")
//   · 그룹은 **행이 옮겨 다니는 흐름**이 있을 때만 여러 개 만든다(할 일·수주·요청).
//     이때는 상태 컬럼을 따로 두지 않는다 — 그룹이 곧 상태라 두 번 적게 된다.
//   · 흐름이 없고 '목록'인 표(집행·비용·일정)는 **그룹 하나**로 시작하고 상태 컬럼을 쓴다.
//     필요하면 사용자가 그룹을 더 만든다(월별·채널별 등, 회사마다 다르다).
//
// 절대규칙: 순수 정의만 둔다(조회·side-effect 0). 화면과 시드가 이 파일만 본다.

//   partner = 거래처(검색 + 그 자리에서 신규 등록). 값은 partners.id 를 담는다.
export type ColType = "text" | "number" | "date" | "status" | "person" | "partner";

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
    ],
    // 행을 그룹 사이로 옮기는 흐름이라 상태 컬럼을 따로 두지 않는다
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
    // 목록형 — 상태는 컬럼이 맡는다. 월별·채널별로 나누고 싶으면 사용자가 그룹을 더 만든다
    groups: [{ name: "집행 목록", color: C.indigo }],
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
      { name: "거래처", type: "partner" },
      { name: "예상", type: "number", settings: { unit: "원" } },
      { name: "확정", type: "number", settings: { unit: "원" } },
      { name: "결제일", type: "date" },
      { name: "상태", type: "status", settings: PROGRESS },
    ],
    groups: [{ name: "지출 목록", color: C.indigo }],
  },
  {
    key: "pipeline",
    name: "수주 · 매출",
    desc: "들어올 돈을 단계로 관리",
    uses: "영업 파이프라인 · 견적 · 입찰 · 재계약 · 제휴 제안",
    columns: [
      { name: "거래처", type: "partner" },
      { name: "금액", type: "number", settings: { unit: "원" } },
      { name: "확률", type: "number", settings: { unit: "%" } },
      { name: "예상일", type: "date" },
      { name: "담당", type: "person" },
    ],
    // 단계가 곧 그룹이다 — 행을 옮기며 관리한다
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
      { name: "링크", type: "text" },
    ],
    // 요청 → 작업 → 검수 → 완료 로 옮겨 다니는 흐름이라 그룹이 상태를 대신한다
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
    groups: [{ name: "일정", color: C.indigo }],
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

// ── 정리(요약) — 컬럼 타입만 보고 만든다(2026-08-03 기획 v2 4단계) ──
//   템플릿을 새로 만들어도 이 함수는 그대로다. 값이 없는 항목은 만들지 않는다.
export type SummaryCard =
  | { kind: "number"; label: string; sum: number; avg: number; filled: number; unit: string }
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
    if (parts.length > 0) cards.push({ kind: "group", label: "그룹별", parts });
  }

  const numberCols = cols.filter((c) => c.type === "number");
  for (const c of numberCols) {
    const vals = items.map((it) => Number(it.values?.[c.id])).filter((n) => Number.isFinite(n) && n !== 0);
    if (vals.length === 0) continue;
    const sum = vals.reduce((a, b) => a + b, 0);
    cards.push({ kind: "number", label: c.name, sum, avg: Math.round(sum / vals.length), filled: vals.length, unit: c.settings?.unit || "" });
  }
  // 숫자 컬럼이 둘이면 차이도 준다(예산−집행 = 잔여 / 예상−확정)
  if (numberCols.length >= 2) {
    const [a, b] = numberCols;
    const sa = sumColumn(items, a.id), sb = sumColumn(items, b.id);
    if (sa !== 0 || sb !== 0) {
      cards.push({ kind: "diff", label: `${a.name} − ${b.name}`, value: sa - sb, a: a.name, b: b.name, unit: a.settings?.unit || "" });
    }
  }

  for (const c of cols.filter((x) => x.type === "status")) {
    const options: any[] = c.settings?.options || [];
    const parts = options.map((o) => ({
      label: o.label, color: o.color, count: items.filter((it) => it.values?.[c.id] === o.id).length,
    })).filter((p) => p.count > 0);
    if (parts.length === 0) continue;
    const done = options.find((o) => /완료|종료|계약/.test(String(o.label)));
    const doneCount = done ? items.filter((it) => it.values?.[c.id] === done.id).length : 0;
    const total = parts.reduce((n, p) => n + p.count, 0);
    cards.push({ kind: "status", label: c.name, parts, doneRate: done && total > 0 ? Math.round((doneCount / total) * 100) : null });
  }

  for (const c of cols.filter((x) => x.type === "date")) {
    const dates = items.map((it) => String(it.values?.[c.id] || "")).filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d));
    if (dates.length === 0) continue;
    const late = dates.filter((d) => d < today).length;
    const week = new Date(new Date(`${today}T00:00:00`).getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
    const soon = dates.filter((d) => d >= today && d <= week).length;
    const next = dates.filter((d) => d >= today).sort()[0] || null;
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
