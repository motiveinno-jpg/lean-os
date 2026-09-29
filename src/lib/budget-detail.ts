import { logRead } from "@/lib/log-read";
// 경영흐름 월별표 — 금액 셀 드릴다운(산출 내역) (2026-07-01)
//   레코드 기반 행(매출·고정비·변동비·대표가수금·통장잔액)의 개별 내역을 조회.
//   집계 로직은 cash-budget.ts getMonthlyBudgetOverview 와 동일하게 맞춰 셀 값과 정합 유지.
//   파생행(수입/지출 총액·순이익·BEP 등)은 이미 로드된 값으로 FlowMatrix 에서 계산(여기 미포함).

import { supabase } from "@/lib/supabase";
import { fetchPaged, fetchPagedRes } from "@/lib/fetch-paged";
import { loadFixedCostSources, fixedCostLinesForMonth } from "./cash-budget";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

export interface BudgetDetailItem {
  label: string;
  sub?: string;   // 날짜/부가정보
  amount: number;
  // 산출 모달에서 직접 삭제/해제 가능하게 출처·id (고정비 행에만 채움)
  refType?: "recurring" | "fixed_cost" | "bank";
  refId?: string;
}

// 이 행들만 개별 레코드 조회 대상
export const RECORD_BACKED_KEYS = new Set(["salesRevenue", "ownerInjection", "fixedCosts", "variableCosts", "bankBalance"]);

const pick = (row: any, keys: string[], fallback: string): string => {
  for (const k of keys) { const v = row?.[k]; if (v != null && String(v).trim() !== "") return String(v); }
  return fallback;
};

function monthBounds(year: number, month: number) {
  const mm = String(month).padStart(2, "0");
  const start = `${year}-${mm}-01`;
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return { start, next };
}

export async function getBudgetCellDetail(
  companyId: string,
  year: number,
  month: number, // 1~12
  rowKey: string,
): Promise<BudgetDetailItem[]> {
  const { start, next } = monthBounds(year, month);

  if (rowKey === "salesRevenue") {
    const data = await fetchPaged<any>('lib/budget-detail:sales', () => db.from("tax_invoices").select("*")
      .eq("company_id", companyId).eq("type", "sales")
      .neq("status", "void").neq("status", "draft")   // 셀 값과 같은 기준
      .gte("issue_date", start).lt("issue_date", next)
      .order("issue_date", { ascending: true })
      .order("id"));
    return (data ?? []).map((r: any) => ({
      label: pick(r, ["counterparty_name", "partner_name", "buyer_name"], "매출"),
      sub: `${r.issue_date ?? ""} · 공급가액 (부가세 ${Number(r.tax_amount || 0).toLocaleString("ko-KR")} 별도)`,
      amount: Number(r.supply_amount || 0),   // 셀 값(공급가액)과 같은 기준
    }));
  }

  if (rowKey === "ownerInjection") {
    const data = logRead('lib/budget-detail:data', await db.from("owner_injections").select("*")
      .eq("company_id", companyId)
      .gte("date", start).lt("date", next)
      .order("date", { ascending: true }));
    return (data ?? []).map((r: any) => ({
      label: pick(r, ["memo", "note", "description"], "대표 가수금"),
      sub: r.date ?? undefined,
      amount: Number(r.amount || 0),
    }));
  }

  if (rowKey === "fixedCosts") {
    //   셀 값과 같은 줄 — cash-budget.fixedCostLinesForMonth 한 벌(정기 지출·고정비 표·급여·통장 고정비 체크, 중복 제거 포함)
    const ym = `${year}-${String(month).padStart(2, "0")}`;
    const src = await loadFixedCostSources(companyId, start, `${ym}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`);
    return fixedCostLinesForMonth(src, ym).map((l) => ({
      label: l.label, sub: l.sub, amount: l.amount,
      ...(l.source === "recurring" && l.refId ? { refType: "recurring" as const, refId: l.refId } : {}),
      ...(l.source === "fixed_cost" && l.refId ? { refType: "fixed_cost" as const, refId: l.refId } : {}),
      ...(l.source === "bank" && l.refId ? { refType: "bank" as const, refId: l.refId } : {}),
    }));
  }

  if (rowKey === "variableCosts") {
    // payment_queue(비반복, 당월) + card_transactions(당월)
    const [pqRes, ctRes] = await Promise.all([
      db.from("payment_queue").select("*").eq("company_id", companyId)
        .gte("created_at", start).lt("created_at", next),
      fetchPagedRes<any>("lib/budget-detail:cards", () => db.from("card_transactions").select("*").eq("company_id", companyId)
        .gte("transaction_date", start).lt("transaction_date", next)
        .order("transaction_date", { ascending: true }).order("id", { ascending: true }), 50000),
    ]);
    const items: BudgetDetailItem[] = [];
    for (const p of (pqRes.data ?? [])) {
      if (p.is_recurring) continue;              // 비반복만 (변동비 정의)
      if (p.status === "cancelled") continue;    // 취소된 지출은 비용이 아니다 (2026-08-10)
      items.push({ label: pick(p, ["description", "category"], "지급"), sub: (p.created_at ?? "").slice(0, 10) || undefined, amount: Number(p.amount || 0) });
    }
    for (const t of (ctRes.data ?? [])) {
      items.push({ label: pick(t, ["merchant_name", "category"], "카드"), sub: t.transaction_date ?? undefined, amount: Number(t.amount || 0) });
    }
    return items;
  }

  if (rowKey === "bankBalance") {
    //   셀 값 = 현재 잔액 − (그 달 말일 다음 날 ~ 오늘 통장 순입출금). cash-budget.monthEndBalances 와 같은 식
    const ym = `${year}-${String(month).padStart(2, "0")}`;
    const end = `${ym}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
    const [accRes, flows] = await Promise.all([
      db.from("bank_accounts").select("*").eq("company_id", companyId),
      fetchPaged<any>("lib/budget-detail:bank-after", () => db.from("bank_transactions").select("id, amount, type, transaction_date")
        .eq("company_id", companyId).gt("transaction_date", end)
        .order("transaction_date", { ascending: true }).order("id"), 100000),
    ]);
    const accounts = ((accRes.data ?? []) as any[]).map((a: any) => ({
      label: `${pick(a, ["alias", "bank_name"], "통장")} · 현재 잔액`,
      sub: pick(a, ["account_number"], ""),
      amount: Number(a.balance || 0),
    }));
    const inflow = flows.filter((f: any) => f.type === "income").reduce((s: number, f: any) => s + Math.abs(Number(f.amount || 0)), 0);
    const outflow = flows.filter((f: any) => f.type !== "income").reduce((s: number, f: any) => s + Math.abs(Number(f.amount || 0)), 0);
    if (flows.length === 0) return accounts;
    return [
      ...accounts,
      { label: `${end} 이후 입금 빼기`, sub: `통장 거래 ${flows.filter((f: any) => f.type === "income").length}건`, amount: -inflow },
      { label: `${end} 이후 출금 되돌리기`, sub: `통장 거래 ${flows.filter((f: any) => f.type !== "income").length}건`, amount: outflow },
    ];
  }

  return [];
}
