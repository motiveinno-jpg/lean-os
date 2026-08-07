// 프로젝트 돈 집계 — 표(템플릿)를 가로질러 한 장으로 (2026-08-05 기획).
//
// 사장님 질문: "전표는 입력했는데 계산서까지 발행 안 된 경우, 지출로 잡았으나 실제 출금이
//   안 된 경우… 예상과 실금액을 각기 나눠 보여주면 지표가 너무 많아져 혼동이 온다."
//
// 답: **금액을 여러 개 나열하지 않고, 하나의 금액이 단계를 지나가게 한다.**
//   돈은 상태가 하나가 아니라 단계를 밟는다. 그래서 숫자 4개가 아니라 막대 하나로 본다.
//     계획(쓰기로 함) → 확정(전표·발주) → 증빙(계산서·영수증) → 지급(통장에서 나감)
//   수입도 대칭이다: 검토 → 제안 → 계약 → 발행 → 입금. '매출 흐름' 템플릿의 단계와 같은
//   구조라 화면 하나로 통일된다.
//
// 이중 계상(2026-08-07 정리): 예전엔 표가 넷이었다 — 매출·청구 / 수주·매출 / 비용·지출 / 집행·성과.
//   수입 쪽 둘은 같은 축에 그냥 더해져 **경고도 없이** 두 번 잡혔고(수주에서 계약된 건을 청구 표로
//   옮겨 적으면 그렇게 된다), 지출 쪽 둘은 경고로 막고 있었다. 표를 둘로 합쳐(매출 흐름 / 예산 · 지출)
//   원인을 없앴다. 합치기 전 표도 같은 성격(templateKind)으로 읽으므로 셈은 달라지지 않는다.
//   겹침 경고는 남긴다 — 지출 표를 여러 개 만들어 쓰는 경우가 있다.
//
// 절대규칙: 순수 함수. 조회는 화면이 하고 여기서는 계산만 한다.

import { templateKind, flowColumnOf, START_DATE_RE, type BoardColumn, type BoardItem } from "@/lib/project-boards";
import { addDaysStr, mondayOfStr, daysBetweenStr } from "@/lib/kst";

/** 돈이 지나가는 단계 — 수입·지출이 같은 축을 쓴다 */
export type MoneyStage = "plan" | "fixed" | "billed" | "paid";

export const STAGE_ORDER: MoneyStage[] = ["plan", "fixed", "billed", "paid"];

export const STAGE_LABEL: Record<"income" | "spend", Record<MoneyStage, string>> = {
  income: { plan: "예상", fixed: "계약", billed: "발행", paid: "입금" },
  spend: { plan: "계획", fixed: "확정", billed: "증빙", paid: "지급" },
};

/** 단계 라벨 → 단계. 사용자가 라벨을 바꿔도 뜻이 통하게 낱말로 읽는다. */
export function stageOfLabel(label: string): MoneyStage {
  const s = String(label || "");
  if (/입금|지급|수금|완료|결제됨/.test(s)) return "paid";
  if (/발행|증빙|계산서|영수증|검수/.test(s)) return "billed";
  if (/계약|확정|승인|진행/.test(s)) return "fixed";
  return "plan";
}

export type MoneyBoard = { id: string; name: string; template_key: string | null };

/** 한 축(수입 또는 지출)의 집계 — 단계별 금액 + 합계 */
export type Axis = {
  /** 단계별 금액(누적 아님 — 그 단계에 머물러 있는 금액) */
  byStage: Record<MoneyStage, number>;
  /** 총액 = 모든 단계 합. 막대의 전체 길이 */
  total: number;
  /** 실제로 끝난 금액(지급/입금) */
  done: number;
  /** 건수 */
  count: number;
};

export type StuckItem = { name: string; amount: number; stage: MoneyStage; days: number | null };

export type MoneyRollup = {
  income: Axis;
  spend: Axis;
  /** 마진 — 기준에 따라 달라진다. basis 를 반드시 화면에 적을 것 */
  margin: number;
  marginRate: number | null;
  /** 마진을 만든 재료 — 기준에 맞춰 실제로 센 금액.
   *  확정 기준에서 계획 단계만 있는 프로젝트는 둘 다 0이라 마진도 0이 된다.
   *  그때 화면이 '마진 0원'이라고만 하면 나갈 돈이 억대인데도 0으로 읽혀 오해가 생긴다 —
   *  그래서 화면이 이 값을 보고 다르게 말할 수 있게 함께 돌려준다 (2026-08-07). */
  settled: { income: number; spend: number };
  /** 예산 소진 — '집행 · 성과' 표에서만. 지출 합계에는 넣지 않는다 */
  budget: { planned: number; spent: number; rate: number | null } | null;
  /** 같은 지출이 두 표에 들어간 것으로 보이는 쌍 */
  overlaps: { amount: number; a: string; b: string }[];
  /** 다음 단계로 안 넘어간 채 오래 머문 건 */
  stuck: StuckItem[];
};

/** 어느 기준으로 보나 — 화면 토글 둘. 기본은 '확정 기준' */
export type Basis = "accrual" | "cash";

const num = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const isWon = (c: BoardColumn) => c.type === "number" && (c.settings?.unit || "") === "원";

/** 이 표에서 '금액' 으로 볼 컬럼 — 실적 쪽을 먼저 고른다(확정 > 예상) */
function amountColumnOf(cols: BoardColumn[], prefer: RegExp, fallback: RegExp): BoardColumn | null {
  const won = cols.filter(isWon);
  return won.find((c) => prefer.test(c.name)) || won.find((c) => fallback.test(c.name)) || won[0] || null;
}

function emptyAxis(): Axis {
  return { byStage: { plan: 0, fixed: 0, billed: 0, paid: 0 }, total: 0, done: 0, count: 0 };
}

function addToAxis(ax: Axis, stage: MoneyStage, amount: number) {
  if (amount <= 0) return;
  ax.byStage[stage] += amount;
  ax.total += amount;
  if (stage === "paid") ax.done += amount;
  ax.count += 1;
}

/**
 * 표를 가로질러 돈을 모은다.
 *   basis="accrual"(기본) — 약속된 돈까지 센다(계획 제외, 확정부터)
 *   basis="cash"          — 실제로 오간 돈만 센다(지급/입금만)
 */
export function rollupMoney(
  boards: MoneyBoard[], cols: BoardColumn[], items: BoardItem[],
  opts: { basis?: Basis; today?: string } = {},
): MoneyRollup {
  const basis: Basis = opts.basis || "accrual";
  const today = opts.today || "";
  const income = emptyAxis();
  const spend = emptyAxis();
  let planned = 0, spent = 0;
  let hasBudget = false;
  const stuck: StuckItem[] = [];
  //   board 를 함께 담는다 — 같은 금액이 **다른 표**에 또 있으면 같은 지출을 두 번 적은 것이다
  const spendRows: { board: string; name: string; amount: number }[] = [];

  for (const b of boards) {
    const bCols = cols.filter((c) => c.board_id === b.id);
    const bItems = items.filter((i) => i.board_id === b.id);
    if (bItems.length === 0) continue;
    const flow = flowColumnOf(bCols);
    const options: any[] = (flow?.settings?.options || []) as any[];
    const stageOf = (it: BoardItem): MoneyStage => {
      if (!flow) return "plan";
      const opt = options.find((o) => o.id === it.values?.[flow.id]);
      return opt ? stageOfLabel(opt.label) : "plan";
    };
    // 단계에 머문 기간 — 마감 계열 날짜가 지났는데 안 끝났으면 '막힌 것'
    const dueCol = bCols.find((c) => c.type === "date" && !START_DATE_RE.test(c.name));
    const daysPast = (it: BoardItem): number | null => {
      if (!dueCol || !today) return null;
      const v = String(it.values?.[dueCol.id] || "");
      if (!/^\d{4}-\d{2}-\d{2}/.test(v) || v >= today) return null;
      return daysBetweenStr(today, v.slice(0, 10));
    };

    const kind = templateKind(b.template_key);

    if (kind === "revenue") {
      //   받을 돈 — 검토 → 제안 → 계약 → 발행 → 입금 한 줄 (2026-08-07 '매출 흐름' 으로 합침).
      //   확률은 **계약 전에만** 쓴다. 계약부터는 액면가가 곧 받을 돈이라 가중하면 되레 줄여 읽는다.
      //   합치기 전 표(매출·청구 / 수주·매출)도 같은 규칙으로 읽는다 — 확률 칸이 없으면 액면 그대로.
      const amt = amountColumnOf(bCols, /금액|청구/, /./);
      const pct = bCols.find((c) => c.type === "number" && (c.settings?.unit || "") === "%");
      if (!amt) continue;
      for (const it of bItems) {
        const raw = num(it.values?.[amt.id]);
        if (raw <= 0) continue;
        const st = stageOf(it);
        const p = pct ? num(it.values?.[pct.id]) : 0;
        const v = st === "plan" && p > 0 ? Math.round(raw * (p / 100)) : raw;
        addToAxis(income, st, v);
        const d = daysPast(it);
        if (st !== "paid" && d != null && d >= 7) stuck.push({ name: it.name || "이름 없음", amount: v, stage: st, days: d });
      }
    } else if (kind === "spend") {
      //   나갈 돈 — 예산을 잡고 실제로 쓴다 (2026-08-07 '예산 · 지출' 로 합침).
      //   집행액이 있으면 그것이 실제 지출이고, 없으면 예산을 '계획' 으로만 센다.
      //   예산 소진율도 같은 표에서 나온다 — 예전엔 표가 둘로 갈려 같은 지출이 두 번 잡혔다.
      const realCol = bCols.filter(isWon).find((c) => /집행|확정|실제|지급|사용/.test(c.name));
      const planCol = bCols.filter(isWon).find((c) => /예산|예상|계획/.test(c.name));
      for (const it of bItems) {
        const st = stageOf(it);
        const realV = realCol ? num(it.values?.[realCol.id]) : 0;
        const planV = planCol ? num(it.values?.[planCol.id]) : 0;
        const v = realV > 0 ? realV : planV;
        const useStage: MoneyStage = realV > 0 ? st : "plan";
        addToAxis(spend, useStage, v);
        if (v > 0) spendRows.push({ board: b.id, name: it.name || "", amount: v });
        if (planV > 0) { hasBudget = true; planned += planV; spent += realV; }
        const d = daysPast(it);
        if (v > 0 && useStage !== "paid" && d != null && d >= 7) stuck.push({ name: it.name || "이름 없음", amount: v, stage: useStage, days: d });
      }
    }
  }

  // 겹침 — 금액이 똑같은 건이 **서로 다른 지출 표**에 있으면 같은 지출을 두 번 적었을 가능성이 높다.
  //   '예산 · 지출' 하나만 쓰면 생기지 않는다(합치기 전 표를 함께 쓰는 경우를 위해 남긴다).
  const overlaps: MoneyRollup["overlaps"] = [];
  for (const s of spendRows) {
    const hit = spendRows.find((o) => o.board !== s.board && o.amount === s.amount
      && !overlaps.some((x) => x.b === o.name || x.a === o.name));
    if (hit && !overlaps.some((x) => x.a === s.name || x.b === s.name)) {
      overlaps.push({ amount: s.amount, a: s.name, b: hit.name });
    }
  }

  const pick = (ax: Axis) => (basis === "cash" ? ax.byStage.paid : ax.total - ax.byStage.plan);
  const inc = pick(income), sp = pick(spend);
  const margin = inc - sp;

  return {
    income, spend, margin,
    marginRate: inc > 0 ? Math.round((margin / inc) * 100) : null,
    settled: { income: inc, spend: sp },
    budget: hasBudget ? { planned, spent, rate: planned > 0 ? Math.round((spent / planned) * 100) : null } : null,
    overlaps,
    stuck: stuck.sort((a, b) => b.amount - a.amount).slice(0, 5),
  };
}

/** 기준을 화면에 반드시 적는다 — 어느 기준인지 모르는 게 제일 위험하다 */
export const BASIS_LABEL: Record<Basis, string> = { accrual: "확정 기준", cash: "현금 기준" };
export const BASIS_NOTE: Record<Basis, string> = {
  accrual: "계약·발주까지 잡은 금액 (계획만 있는 건 제외)",
  cash: "실제로 오간 돈만 (입금·지급)",
};

// ── 주별 예정 자금 — "언제 자금이 비나" (2026-08-05 기획 3차) ──
//   대표가 실제로 묻는 건 총액이 아니라 **시점**이다. 이번 주부터 8주를 놓고
//   들어올 돈과 나갈 돈을 같은 축(원)에 위·아래로 놓는다.
//   ⚠️ 잔액 누적선을 같이 그리면 축이 둘이 된다(금지). 대신 주마다 순액을 숫자로 적는다.

export type CashWeek = {
  /** 그 주 월요일 (YYYY-MM-DD). 지난 것은 "past" */
  key: string;
  label: string;
  income: number;
  spend: number;
  /** 들어올 − 나갈 */
  net: number;
};

/**
 * 아직 안 끝난 건만 센다 — 입금·지급된 건은 이미 지나간 돈이라 앞날 계획이 아니다.
 * 기한이 이미 지난 미완료 건은 맨 앞 '지남' 칸에 모은다(숨기면 영영 안 보인다).
 */
export function weeklyCashflow(
  boards: MoneyBoard[], cols: BoardColumn[], items: BoardItem[],
  today: string, weeks = 8,
): CashWeek[] {
  const thisMon = mondayOfStr(today);
  const buckets = new Map<string, CashWeek>();
  buckets.set("past", { key: "past", label: "지남", income: 0, spend: 0, net: 0 });
  for (let i = 0; i < weeks; i++) {
    const k = addDaysStr(thisMon, i * 7);
    const md = `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`;
    buckets.set(k, { key: k, label: i === 0 ? `이번 주 ${md}` : md, income: 0, spend: 0, net: 0 });
  }
  const lastMon = addDaysStr(thisMon, (weeks - 1) * 7);

  for (const b of boards) {
    //   합친 뒤에는 '매출 흐름'·'예산 · 지출' 두 성격만 본다(합치기 전 표도 같은 성격으로 읽힌다)
    const tk = templateKind(b.template_key);
    const kind: "income" | "spend" | null = tk === "revenue" ? "income" : tk === "spend" ? "spend" : null;
    if (!kind) continue;
    const bCols = cols.filter((c) => c.board_id === b.id);
    const flow = flowColumnOf(bCols);
    const options: any[] = (flow?.settings?.options || []) as any[];
    const dateCol = bCols.find((c) => c.type === "date" && !START_DATE_RE.test(c.name));
    if (!dateCol) continue;
    const amtCol = kind === "income"
      ? bCols.filter(isWon).find((c) => /금액|청구/.test(c.name)) || bCols.filter(isWon)[0]
      : bCols.filter(isWon).find((c) => /집행|확정|실제|지급/.test(c.name)) || bCols.filter(isWon).find((c) => /예산|예상|계획/.test(c.name));
    if (!amtCol) continue;
    const fallbackCol = kind === "spend" ? bCols.filter(isWon).find((c) => /예산|예상|계획/.test(c.name)) : null;

    for (const it of items.filter((i) => i.board_id === b.id)) {
      const opt = flow ? options.find((o) => o.id === it.values?.[flow.id]) : null;
      const stage: MoneyStage = opt ? stageOfLabel(opt.label) : "plan";
      if (stage === "paid") continue;          // 이미 오간 돈
      const v = num(it.values?.[amtCol.id]) || (fallbackCol ? num(it.values?.[fallbackCol.id]) : 0);
      if (v <= 0) continue;
      const d = String(it.values?.[dateCol.id] || "");
      if (!/^\d{4}-\d{2}-\d{2}/.test(d)) continue;
      const day = d.slice(0, 10);
      const mon = mondayOfStr(day);
      const key = day < thisMon ? "past" : (mon > lastMon ? null : mon);
      if (!key) continue;                      // 8주 밖은 안 그린다
      const w = buckets.get(key);
      if (!w) continue;
      if (kind === "income") w.income += v; else w.spend += v;
    }
  }
  const out = [...buckets.values()];
  out.forEach((w) => { w.net = w.income - w.spend; });
  // 지난 것이 없으면 그 칸은 안 그린다
  return out.filter((w) => w.key !== "past" || w.income > 0 || w.spend > 0);
}

/** 이 프로젝트에 '돈 흐름'으로 보여줄 값이 있나 — 정리 화면이 리포트 껍데기를 그릴지 정할 때 쓴다.
 *  값이 없으면 ProjectMoneyReport 가 아무것도 안 그리는데, 껍데기만 먼저 그리면
 *  제목만 있고 속이 빈 리포트가 남는다(2026-08-07 사장님 지적 화면). */
export function hasMoneyData(boards: MoneyBoard[], cols: BoardColumn[], items: BoardItem[], today: string): boolean {
  const r = rollupMoney(boards, cols, items, { basis: "accrual", today });
  return r.income.total > 0 || r.spend.total > 0 || !!r.budget;
}
