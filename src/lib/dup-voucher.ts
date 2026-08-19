// 중복 의심 전표 (2026-08-19, docs/20260819_PLAN_duplicate_voucher_handling.md)
//   통장·카드 거래를 전표로 만들기 전에 "같은 날 · 같은 금액의 전표(수기 포함)"가 이미 있는지 본다.
//   있으면 화면이 세 갈래를 묻는다: 새 전표 / 이미 있는 전표에 연결(장부 불변, 거래만 '전표됨') / 취소.
//   연결 = 거래의 journal_entry_id 를 기존 전표로 — 재무제표는 그대로, 목록에서는 사라지고 다시 못 침(ALREADY_POSTED).

import { supabase } from "@/lib/supabase";

export type DupEntry = { id: string; voucher_no: number | null; description: string; entry_date: string; source: string; total: number; linkedCount: number };

/** 같은 날 같은 금액(차변 합계) 전표 — 반려·취소 제외. 이미 이 종류의 거래가 여러 개 걸린 전표도 보여 주되 linkedCount 로 표시 */
export async function findDuplicateEntries(companyId: string, date: string, amount: number, opts?: { limit?: number }): Promise<DupEntry[]> {
  const amt = Math.abs(Math.round(amount));
  if (!companyId || !date || amt <= 0) return [];
  const { data: entries } = await supabase.from("journal_entries")
    .select("id, voucher_no, description, entry_date, source, status")
    .eq("company_id", companyId).eq("entry_date", date)
    .not("status", "in", "(rejected,cancelled,void)")
    .limit(200);
  const ids = (entries || []).map((e: any) => e.id as string);
  if (ids.length === 0) return [];
  const { data: lines } = await supabase.from("journal_lines").select("entry_id, debit").in("entry_id", ids);
  const totals = new Map<string, number>();
  for (const l of (lines || []) as any[]) totals.set(l.entry_id, (totals.get(l.entry_id) || 0) + Number(l.debit || 0));
  const hits = (entries || []).filter((e: any) => Math.abs(Math.round(totals.get(e.id) || 0) - amt) <= 1);
  if (hits.length === 0) return [];
  const hitIds = hits.map((e: any) => e.id as string);
  const [bk, cd] = await Promise.all([
    supabase.from("bank_transactions").select("journal_entry_id").in("journal_entry_id", hitIds),
    supabase.from("card_transactions").select("journal_entry_id").in("journal_entry_id", hitIds),
  ]);
  const linked = new Map<string, number>();
  for (const r of [...((bk.data || []) as any[]), ...((cd.data || []) as any[])]) linked.set(r.journal_entry_id, (linked.get(r.journal_entry_id) || 0) + 1);
  return hits.slice(0, opts?.limit ?? 5).map((e: any) => ({
    id: e.id, voucher_no: e.voucher_no ?? null, description: e.description || "", entry_date: e.entry_date, source: e.source || "",
    total: Math.round(totals.get(e.id) || 0), linkedCount: linked.get(e.id) || 0,
  }));
}

/** 거래를 기존 전표에 건다 — 전표는 안 만든다. 이미 전표가 걸린 거래면 아무것도 안 하고 false */
export async function linkTransactionToEntry(kind: "bank" | "card", txId: string, entryId: string): Promise<boolean> {
  const tbl = kind === "bank" ? "bank_transactions" : "card_transactions";
  const { data, error } = await supabase.from(tbl).update({ journal_entry_id: entryId } as never).eq("id", txId).is("journal_entry_id", null).select("id");
  if (error) throw error;
  return (data || []).length > 0;
}

export const SOURCE_LABEL: Record<string, string> = { manual: "수기(일반전표)", bank: "통장", card: "카드", tax_invoice: "세금계산서", cash_receipt: "현금영수증", sale_purchase: "매입매출전표", auto: "자동" };

// ── 장부 제외 (2026-08-19) — 전표 없이 '끝난 것'으로. reason=null 이면 되돌림 ──
export const EXCLUDE_REASONS: [string, string][] = [["dup", "중복 — 이미 다른 전표에 반영됨"], ["transfer", "계좌 간 이체 · 카드 대금 결제"], ["personal", "개인 지출 · 개인 입금(반환)"], ["etc", "기타"]];
export const EXCLUDE_LABEL: Record<string, string> = { dup: "중복", transfer: "이체", personal: "개인", etc: "기타" };
export const excludeLabelOf = (reason: string | null | undefined) => { if (!reason) return ""; const [k, ...rest] = reason.split(":"); return `${EXCLUDE_LABEL[k] || k}${rest.length ? ` · ${rest.join(":")}` : ""}`; };
export async function setLedgerExcluded(kind: "bank" | "card", txIds: string[], reason: string | null): Promise<number> {
  if (txIds.length === 0) return 0;
  const tbl = kind === "bank" ? "bank_transactions" : "card_transactions";
  let q = supabase.from(tbl).update({ ledger_excluded_reason: reason } as never).in("id", txIds);
  if (reason) q = q.is("journal_entry_id", null);   // 전표가 있는 건은 제외로 못 바꾼다(전표를 취소하는 게 맞다)
  const { data, error } = await q.select("id");
  if (error) throw error;
  return (data || []).length;
}
