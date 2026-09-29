// 프로젝트 v3 표(project_items · project_item_columns) 집계 — 목록·현황판·상세 보고가 같은 셈을 쓰게 한 곳에 모은다.
//   종전엔 화면마다 따로 셌다:
//     · '변동 없는 프로젝트' 패널은 옛 업무(project_tasks)·생성 시각만 봐서, 표를 어제 고친 프로젝트도 '97일째 변동 없음'.
//     · 상세 보고의 '견적·계약 N건'은 문서가 붙은 줄(__quote·__contract)만 세고, 목록 요약은 '견적·계약' 흐름 칸의
//       마지막 선택지(확정·완료)를 세서 같은 프로젝트가 '0건'과 '11건'으로 갈렸다.
//     · 현황판 신호등 '보고 없음'은 표에 줄이 있는 프로젝트만 세서 합계가 진행 중 프로젝트 수와 안 맞았다.
//   절대규칙: 순수 함수. 조회는 화면이 한다.

export const QUOTE_LINK_KEY = "__quote";
export const CONTRACT_LINK_KEY = "__contract";

const DONE_COLOR = "#00c875";
const DAY = 86_400_000;

export type V3Column = {
  deal_id?: string;
  key: string;
  name: string;
  type: string;
  settings?: { options?: { id: string; label?: string; color?: string }[] } | null;
};
export type V3Item = { deal_id: string; parent_id?: string | null; updated_at?: string | null; fields?: Record<string, unknown> | null };

/** 흐름 칸 — 마지막 선택지가 완료 톤(초록)인 select. '유형·채널' 같은 분류 select 는 제외한다. */
export function isFlowColumn(c: V3Column): boolean {
  const opts = c.settings?.options || [];
  return c.type === "select" && opts.length >= 2 && String(opts[opts.length - 1].color || "").toLowerCase() === DONE_COLOR;
}

/** 흐름 칸의 끝(완료) 선택지 id */
export function flowDoneId(c: V3Column): string | null {
  const opts = c.settings?.options || [];
  return opts.length ? opts[opts.length - 1].id : null;
}

// 견적·계약 흐름 칸 — 이름으로 찾는다('매출 흐름' 템플릿의 '견적'·'계약' 칸, 사용자가 만든 같은 뜻의 칸 포함).
const QUOTE_COL_RE = /견적/;
const CONTRACT_COL_RE = /계약/;

export type MoneyPredicates = {
  /** 견적까지 간 줄 — 견적서가 붙었거나 견적 흐름 칸이 끝(확정)에 닿음 */
  isQuote: (it: V3Item) => boolean;
  /** 계약까지 간 줄 — 계약서가 붙었거나 계약 흐름 칸이 끝(완료)에 닿음 */
  isContract: (it: V3Item) => boolean;
};

export function moneyPredicates(cols: V3Column[]): MoneyPredicates {
  const flows = cols.filter(isFlowColumn);
  const quoteCols = flows.filter((c) => QUOTE_COL_RE.test(c.name));
  const contractCols = flows.filter((c) => CONTRACT_COL_RE.test(c.name) && !QUOTE_COL_RE.test(c.name));
  const reached = (it: V3Item, list: V3Column[]) => list.some((c) => {
    const done = flowDoneId(c);
    return !!done && (it.fields || {})[c.key] === done;
  });
  return {
    isQuote: (it) => !!(it.fields || {})[QUOTE_LINK_KEY] || reached(it, quoteCols),
    isContract: (it) => !!(it.fields || {})[CONTRACT_LINK_KEY] || reached(it, contractCols),
  };
}

/** 윗줄(하위 항목 제외) 기준 견적·계약 건수. cols 는 그 프로젝트의 칸만 넘긴다. */
export function countQuoteContract(items: V3Item[], cols: V3Column[]): { quoteN: number; contractN: number } {
  const p = moneyPredicates(cols);
  const parents = items.filter((it) => !it.parent_id);
  return { quoteN: parents.filter(p.isQuote).length, contractN: parents.filter(p.isContract).length };
}

/** 여러 프로젝트를 한 번에 — 각 줄을 자기 프로젝트의 칸으로 판정한다. */
export function countQuoteContractAcross(items: V3Item[], cols: V3Column[], dealIds?: Set<string>): { quoteN: number; contractN: number } {
  const colsByDeal = new Map<string, V3Column[]>();
  for (const c of cols) if (c.deal_id) (colsByDeal.get(c.deal_id) || colsByDeal.set(c.deal_id, []).get(c.deal_id)!).push(c);
  const itemsByDeal = new Map<string, V3Item[]>();
  for (const it of items) {
    if (dealIds && !dealIds.has(it.deal_id)) continue;
    (itemsByDeal.get(it.deal_id) || itemsByDeal.set(it.deal_id, []).get(it.deal_id)!).push(it);
  }
  let quoteN = 0, contractN = 0;
  for (const [dealId, list] of itemsByDeal) {
    const r = countQuoteContract(list, colsByDeal.get(dealId) || []);
    quoteN += r.quoteN; contractN += r.contractN;
  }
  return { quoteN, contractN };
}

/**
 * 프로젝트별 마지막 움직임(ms). 표 줄 수정(project_items.updated_at) · 옛 업무 수정 · 프로젝트 생성 중 최신.
 *   목록 '마지막 업데이트' 열, 상태(주의), '변동 없는 프로젝트' 패널이 모두 이 값을 쓴다.
 */
export function lastActivityByDeal(src: {
  deals: { id: string; created_at?: string | null }[];
  items?: { deal_id: string; updated_at?: string | null }[];
  tasks?: { deal_id: string; updated_at?: string | null }[];
}): Record<string, number> {
  const m: Record<string, number> = {};
  const touch = (id: string, iso?: string | null) => {
    if (!id || !iso) return;
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return;
    if (!m[id] || t > m[id]) m[id] = t;
  };
  for (const d of src.deals) touch(d.id, d.created_at);
  for (const it of src.items || []) touch(it.deal_id, it.updated_at);
  for (const t of src.tasks || []) touch(t.deal_id, t.updated_at);
  return m;
}

export function quietDaysOf(lastAt: number | null | undefined, now: number = Date.now()): number | null {
  return lastAt ? Math.floor((now - lastAt) / DAY) : null;
}

export type Signal = "blue" | "orange" | "red";

/** 신호등 합계 — 진행 중 프로젝트 전부가 네 칸 중 하나에 들어간다(최신 보고 기준, 보고 없으면 '보고 없음'). */
export function tallySignals(activeDealIds: string[], reportsNewestFirst: { deal_id: string; signal: string }[]) {
  const active = new Set(activeDealIds);
  const latest = new Map<string, string>();
  for (const r of reportsNewestFirst) if (active.has(r.deal_id) && !latest.has(r.deal_id)) latest.set(r.deal_id, r.signal);
  const out = { blue: 0, orange: 0, red: 0, none: 0 };
  for (const id of active) {
    const s = latest.get(id);
    if (s === "blue" || s === "orange" || s === "red") out[s] += 1;
    else out.none += 1;
  }
  return out;
}
