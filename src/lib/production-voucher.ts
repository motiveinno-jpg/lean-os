// ── 생산 주기 전표 초안 (결정 33, 2026-08-26 사장님 "추천대로") ──────────────────────
//   주기(일/주/월/안 함) 끝에 DB(run_production_voucher_cycles, 매일 06:00 KST)가 그 기간의 생산·자재·불량 폐기 문서를
//   일반전표(대체) **초안**(journal_entries.status = ai_suggested(대기)) 하나로 합친다. 확정은 사람 — 재무 › 현황 › 처리할 것.
//   화면에서는 "지금 만들기"(같은 규칙으로 즉시)·"지난 기간 만들기"(소급)와 설정(주기·계정 3개)만 한다.
//   설정은 company_settings.settings->production_voucher 에 둔다(새 칸 없음).

import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";

export type ProdVoucherCycle = "day" | "week" | "month" | "none";
export const CYCLES: { value: ProdVoucherCycle; label: string; desc: string }[] = [
  { value: "day", label: "매일", desc: "어제 하루치를 매일 아침 초안으로" },
  { value: "week", label: "매주", desc: "지난주(월~일)를 월요일 아침 초안으로" },
  { value: "month", label: "매월", desc: "지난달을 1일 아침 초안으로 (기본)" },
  { value: "none", label: "안 함", desc: "자동으로 만들지 않는다 — 지금 만들기만" },
];
export type ProdVoucherSettings = {
  cycle: ProdVoucherCycle; acct_product: string | null; acct_material: string | null; acct_scrap: string | null;
  //   결정 41 — 매출원가·손실 초안 계정(비면 이름으로: 제품매출원가·상품매출원가·상품·재고자산평가손실·견본비)
  acct_cogs_product?: string | null; acct_cogs_goods?: string | null; acct_goods?: string | null; acct_reval?: string | null; acct_sample?: string | null;
  //   결정 54·55 — 재고자산 맞추기·급여 초안 계정(비면 이름으로: 원재료비·직원급여·예수금·미지급금)
  acct_material_cost?: string | null; acct_salary?: string | null; acct_withholding?: string | null; acct_salary_payable?: string | null;
};
const DEFAULT: ProdVoucherSettings = { cycle: "month", acct_product: null, acct_material: null, acct_scrap: null, acct_cogs_product: null, acct_cogs_goods: null, acct_goods: null, acct_reval: null, acct_sample: null };

export async function loadProdVoucherSettings(companyId: string): Promise<ProdVoucherSettings> {
  const { data } = await supabase.from("company_settings").select("settings").eq("company_id", companyId).maybeSingle();
  const raw = ((data as any)?.settings?.production_voucher || {}) as Partial<ProdVoucherSettings>;
  return { ...DEFAULT, ...raw };
}
export async function saveProdVoucherSettings(companyId: string, s: ProdVoucherSettings) {
  const { data } = await supabase.from("company_settings").select("id, settings").eq("company_id", companyId).maybeSingle();
  const settings = { ...(((data as any)?.settings as Record<string, unknown>) || {}), production_voucher: s };
  if ((data as any)?.id) {
    const { error } = await supabase.from("company_settings").update({ settings } as never).eq("company_id", companyId);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("company_settings").insert({ company_id: companyId, settings } as never);
    if (error) throw error;
  }
}

export type ProdDraft = {
  id: string; kind: "production" | "cogs" | "inventory" | "payroll"; period_from: string; period_to: string; journal_entry_id: string | null; status: "draft" | "confirmed" | "rejected";
  doc_ids: string[]; amount_material: number; amount_product_valued: number; amount_scrap: number; amount_cogs: number; amount_loss: number; skipped_lines: number; memo: string | null; created_at: string;
};
export async function listProdDrafts(companyId: string, limit = 12): Promise<ProdDraft[]> {
  const data = logRead("production-voucher:drafts", await (supabase as any).from("production_voucher_drafts")
    .select("id, kind, period_from, period_to, journal_entry_id, status, doc_ids, amount_material, amount_product_valued, amount_scrap, amount_cogs, amount_loss, skipped_lines, memo, created_at")
    .eq("company_id", companyId).order("period_to", { ascending: false }).limit(limit));
  return ((data || []) as any[]).map((r) => ({ ...r, kind: r.kind || "production", amount_material: Number(r.amount_material || 0), amount_product_valued: Number(r.amount_product_valued || 0), amount_scrap: Number(r.amount_scrap || 0), amount_cogs: Number(r.amount_cogs || 0), amount_loss: Number(r.amount_loss || 0) })) as ProdDraft[];
}

/** 같은 규칙으로 지금 초안을 만든다. 만들 문서가 없으면 null. 계정 매핑이 없으면 throw. */
export async function makeProdDraftNow(from: string, to: string): Promise<string | null> {
  const { data, error } = await (supabase as any).rpc("make_my_production_voucher_draft", { p_from: from, p_to: to });
  if (error) throw error;
  return (data as string | null) ?? null;
}

/** 매출원가·손실 초안(결정 41) — 같은 주기 규칙. 만들 것이 없으면 null. */
export async function makeCogsDraftNow(from: string, to: string): Promise<string | null> {
  const { data, error } = await (supabase as any).rpc("make_my_cogs_voucher_draft", { p_from: from, p_to: to });
  if (error) throw error;
  return (data as string | null) ?? null;
}

/** 재고자산 맞추기 초안(결정 54) — 기준일의 층 원가 가치와 장부 잔액 차액. 차액 없으면 null. */
export async function makeInventoryDraftNow(asof: string): Promise<string | null> {
  const { data, error } = await (supabase as any).rpc("make_my_inventory_voucher_draft", { p_asof: asof });
  if (error) throw error;
  return (data as string | null) ?? null;
}
/** 급여 초안(결정 55) — 그 달 발급된 급여명세 합계만. 명세가 없으면 null. */
export async function makePayrollDraftNow(month: string): Promise<string | null> {
  const { data, error } = await (supabase as any).rpc("make_my_payroll_voucher_draft", { p_month: month });
  if (error) throw error;
  return (data as string | null) ?? null;
}

/** 아직 전표가 없는 생산·자재·불량 폐기 문서 수 — 기간 안 */
export async function countUnvouchedProdDocs(companyId: string, from: string, to: string): Promise<number> {
  const { count } = await supabase.from("stock_docs").select("id", { count: "exact", head: true })
    .eq("company_id", companyId).eq("status", "active").is("journal_entry_id", null).in("reason", ["produce", "consume"])
    .gte("doc_date", from).lte("doc_date", to);
  return count || 0;
}

/** 초안 확정/반려 — 확정하면 DB 트리거가 문서에 전표를 묶는다. */
export async function decideProdDraft(entryId: string, status: "confirmed" | "rejected", userId?: string | null) {
  const patch: Record<string, unknown> = { status, reviewed_at: new Date().toISOString(), reviewed_by: userId ?? null };
  if (status === "confirmed") { patch.is_approved = true; patch.approved_by = userId ?? null; }
  const { error } = await supabase.from("journal_entries").update(patch as never).eq("id", entryId).eq("status", "ai_suggested");
  if (error) throw error;
}
