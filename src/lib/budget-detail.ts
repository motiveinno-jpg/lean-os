import { logRead } from "@/lib/log-read";
// 경영흐름 월별표 — 금액 셀 드릴다운(산출 내역) (2026-07-01)
//   레코드 기반 행(매출·고정비·변동비·대표가수금·통장잔액)의 개별 내역을 조회.
//   집계 로직은 cash-budget.ts getMonthlyBudgetOverview 와 동일하게 맞춰 셀 값과 정합 유지.
//   파생행(수입/지출 총액·순이익·BEP 등)은 이미 로드된 값으로 FlowMatrix 에서 계산(여기 미포함).

import { supabase } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface BudgetDetailItem {
  label: string;
  sub?: string;   // 날짜/부가정보
  amount: number;
  // 직원 QA #9 — 산출 모달에서 직접 삭제/해제 가능하게 출처·id (고정비 행에만 채움)
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
    const data = logRead('lib/budget-detail:data', await db.from("tax_invoices").select("*")
      .eq("company_id", companyId).eq("type", "sales")
      .gte("issue_date", start).lt("issue_date", next)
      .order("issue_date", { ascending: true }));
    return (data ?? []).map((r: any) => ({
      label: pick(r, ["counterparty_name", "partner_name", "buyer_name"], "매출"),
      sub: r.issue_date ?? undefined,
      amount: Number(r.supply_amount || 0) + Number(r.tax_amount || 0),
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
    // getMonthlyBudgetOverview 와 동일: recurring_payments(active) + fixed_costs(기간필터) + 통장 고정비 체크 거래(당월)
    const [recRes, fcRes, btRes] = await Promise.all([
      db.from("recurring_payments").select("*").eq("company_id", companyId).eq("is_active", true),
      db.from("fixed_costs").select("*").eq("company_id", companyId).eq("is_recurring", true),
      db.from("bank_transactions").select("id, counterparty, description, category, classification, transaction_date, amount")
        .eq("company_id", companyId).eq("type", "expense").eq("is_fixed_cost", true)
        .gte("transaction_date", start).lt("transaction_date", next)
        .order("transaction_date", { ascending: true }),
    ]);
    const items: BudgetDetailItem[] = (recRes.data ?? []).map((r: any) => ({
      label: pick(r, ["name", "memo", "description", "category"], "정기지출"),
      sub: r.day_of_month ? `매월 ${r.day_of_month}일` : (r.category ?? undefined),
      amount: Number(r.amount || 0),
      refType: "recurring" as const, refId: r.id,
    }));
    const mm = String(month).padStart(2, "0");
    const lastDay = new Date(year, month, 0).getDate();
    for (const fc of (fcRes.data ?? [])) {
      if (fc.start_date && fc.start_date > `${year}-${mm}-${String(lastDay).padStart(2, "0")}`) continue;
      if (fc.end_date && fc.end_date < `${year}-${mm}-01`) continue;
      items.push({ label: pick(fc, ["name", "memo", "description", "category"], "고정비"), sub: fc.category ?? undefined, amount: Number(fc.amount || 0), refType: "fixed_cost", refId: fc.id });
    }
    // 통장 거래 중 '고정비' 체크(전표처리/매핑) — 당월 실적. 매핑한 분류(계정과목)를 함께 표시(직원 QA)
    for (const t of (btRes.data ?? [])) {
      const cat = t.category || t.classification || "";
      items.push({
        label: pick(t, ["counterparty", "description"], "통장 지출"),
        sub: `${t.transaction_date ?? ""}${cat ? ` · ${cat}` : ""} · 통장 고정비 체크`,
        amount: Math.abs(Number(t.amount || 0)),
        refType: "bank", refId: t.id,
      });
    }
    return items;
  }

  if (rowKey === "variableCosts") {
    // payment_queue(비반복, 당월) + card_transactions(당월)
    const [pqRes, ctRes] = await Promise.all([
      db.from("payment_queue").select("*").eq("company_id", companyId)
        .gte("created_at", start).lt("created_at", next),
      db.from("card_transactions").select("*").eq("company_id", companyId)
        .gte("transaction_date", start).lt("transaction_date", next)
        .order("transaction_date", { ascending: true }),
    ]);
    const items: BudgetDetailItem[] = [];
    for (const p of (pqRes.data ?? [])) {
      if (p.is_recurring) continue; // 비반복만 (변동비 정의)
      items.push({ label: pick(p, ["description", "category"], "지급"), sub: (p.created_at ?? "").slice(0, 10) || undefined, amount: Number(p.amount || 0) });
    }
    for (const t of (ctRes.data ?? [])) {
      items.push({ label: pick(t, ["merchant_name", "category"], "카드"), sub: t.transaction_date ?? undefined, amount: Number(t.amount || 0) });
    }
    return items;
  }

  if (rowKey === "bankBalance") {
    const data = logRead('lib/budget-detail:data', await db.from("bank_accounts").select("*").eq("company_id", companyId));
    return (data ?? []).map((a: any) => ({
      label: pick(a, ["alias", "bank_name"], "통장"),
      sub: pick(a, ["account_number"], ""),
      amount: Number(a.balance || 0),
    }));
  }

  return [];
}
