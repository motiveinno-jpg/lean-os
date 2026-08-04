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

//   partner = 거래처(검색 + 그 자리에서 신규 등록). 값은 partners.id 를 담는다.
export type ColType = "text" | "number" | "date" | "status" | "person" | "partner";

export type StatusOption = { id: string; label: string; color: string };
export type ColumnDef = { name: string; type: ColType; settings?: { options?: StatusOption[]; unit?: string; flow?: boolean } };
export type GroupDef = { name: string; color: string };

/** 보는 방식. 원칙(2026-08-04 사장님 지시):
 *    · grid·board = **입력**하는 화면 — 기본값은 반드시 이 둘 중 하나다.
 *    · timeline·calendar = **읽는** 화면 — 정리한 결과를 보여줄 뿐 입력은 못 한다. 전환으로만 간다.
 *      (timeline = 기간을 본다 / calendar = 언제인지를 본다)
 *  "타임라인은 데이터를 정리해서 보여주는 거고 표가 입력화면이잖아? 입력화면이 기본값으로 나와야" */
export type InputMode = "grid" | "board" | "timeline" | "calendar";

/** 입력이 되는 보기인가 — 기본값 검증과 보기 줄 묶음에 같이 쓴다 */
export const INPUT_MODES: InputMode[] = ["grid", "board"];

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
    key: "billing",
    name: "매출 · 청구",
    desc: "받을 돈을 견적 → 계약 → 발행 → 입금 으로",
    uses: "프로젝트 매출 · 청구 · 수금 · 기성 청구",
    //   회차 금액·예정일·거래처를 나란히 놓고 채우는 일이라 표가 빠르다(칸반은 단계 훑을 때)
    input: "grid",
    columns: [
      { name: "단계", type: "status", settings: FLOW([
        { id: "quote", label: "견적", color: C.gray },
        { id: "contract", label: "계약", color: C.indigo },
        { id: "issued", label: "발행", color: C.purple },
        { id: "paid", label: "입금", color: C.green },
      ]) },
      { name: "거래처", type: "partner" },
      { name: "금액", type: "number", settings: { unit: "원" } },
      { name: "예정일", type: "date" },
      { name: "담당", type: "person" },
      { name: "비고", type: "text" },
    ],
    // 이 템플릿의 행에서는 견적서를 바로 만들 수 있다(ProjectBoards 의 문서 셀).
    groups: [{ name: "청구 목록", color: C.indigo }],
  },
  {
    key: "pipeline",
    name: "수주 · 매출",
    desc: "들어올 돈을 단계로 관리",
    uses: "영업 파이프라인 · 견적 · 입찰 · 재계약 · 제휴 제안",
    input: "board",
    columns: [
      { name: "단계", type: "status", settings: FLOW([
        { id: "review", label: "검토", color: C.gray },
        { id: "proposal", label: "제안", color: C.indigo },
        { id: "won", label: "계약", color: C.green },
      ]) },
      { name: "거래처", type: "partner" },
      { name: "금액", type: "number", settings: { unit: "원" } },
      { name: "확률", type: "number", settings: { unit: "%" } },
      { name: "예상일", type: "date" },
      { name: "담당", type: "person" },
    ],
    groups: [{ name: "수주 목록", color: C.indigo }],
  },
  {
    key: "review",
    name: "요청 · 검수",
    desc: "누가 요청하고 누가 확인하는 흐름",
    uses: "디자인 시안 · 문서 검토 · 고객 요청 처리 · 하자·A/S · 인허가 서류",
    input: "board",
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
    //   기간은 표에서 채우고, 타임라인은 채운 걸 보는 자리다
    input: "grid",
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
  todo: "작업", budget: "항목", cost: "항목", billing: "청구 건", pipeline: "건명", review: "요청", schedule: "이름", blank: "이름",
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
    if (parts.length > 0) cards.push({ kind: "group", label: "그룹별", parts });
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
    if (w > 0) cards.push({ kind: "weighted", label: `가중 ${moneyCol.name}`, value: Math.round(w), a: moneyCol.name, b: pctCol.name });
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
    const week = new Date(new Date(`${today}T00:00:00`).getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
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
