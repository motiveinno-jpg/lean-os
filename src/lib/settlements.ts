// 정산(invoice_settlements) 확정·반려 — 통장 줄 처리 팝업, 세금·증빙 '연결', 수집·전표 매칭 제안이 전부 이 길을 쓴다.
//   확정되면 트리거(trg_recalc_settlement·settlement_autoclose)가 계산서 정산액·상태와 정산 전표를 만든다.
//   화면이 tax_invoices.status 를 직접 'matched' 로 찍던 옛 경로는 정산액을 안 바꿔 원장·미수와 어긋났다.
import { supabase } from "@/lib/supabase";

export type SettleResult = "posted" | "rejected" | "locked" | "no_voucher";

export async function decideSettlement(id: string, st: "confirmed" | "rejected", companyId: string, txDate?: string | null): Promise<SettleResult> {
  if (st === "confirmed" && txDate) {
    const { count } = await (supabase as any).from("closing_checklists").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("month", txDate.slice(0, 7)).eq("status", "locked");
    if (count) return "locked";
  }
  const { error } = await (supabase as any).from("invoice_settlements").update({ status: st }).eq("id", id);
  if (error) throw error;
  if (st === "rejected") return "rejected";
  const { count: n } = await (supabase as any).from("journal_entries").select("id", { count: "exact", head: true }).eq("linked_settlement_id", id).neq("status", "rejected");
  return n ? "posted" : "no_voucher";
}

export const settlementResultToast = (r: SettleResult, month?: string): { msg: string; kind: "success" | "error" | "info" } =>
  r === "posted" ? { msg: "확정 · 정산 전표를 만들었습니다", kind: "success" }
  : r === "rejected" ? { msg: "반려했습니다", kind: "success" }
  : r === "locked" ? { msg: `${month || "그 달"}은 회계마감으로 잠겨 있어 확정하지 않았습니다. 전표가 생기지 않습니다. 마감을 풀고 다시 확정하세요`, kind: "error" }
  : { msg: "확정했지만 전표가 생기지 않았습니다. 계정과목에 103 보통예금·108 외상매출금·251 외상매입금이 있는지 확인하세요", kind: "info" };

/** 통장 거래 ↔ 계산서를 정산 한 건으로 만들어 바로 확정한다 — 세금·증빙 '연결', 수집·전표 매칭 제안이 쓴다.
 *  금액은 계산서 남은 금액과 거래 금액 중 작은 쪽. 마감된 달이면 초안만 남기고 "locked" 를 돌려준다. */
export async function settleBankTxWithInvoice(companyId: string, bankTxId: string, invoiceId: string, source: "manual" | "ai" = "manual"): Promise<SettleResult> {
  const [{ data: tx, error: e1 }, { data: inv, error: e2 }] = await Promise.all([
    (supabase as any).from("bank_transactions").select("id, amount, transaction_date, partner_id").eq("id", bankTxId).eq("company_id", companyId).maybeSingle(),
    (supabase as any).from("tax_invoices").select("id, total_amount, settled_amount, partner_id").eq("id", invoiceId).eq("company_id", companyId).maybeSingle(),
  ]);
  if (e1) throw e1; if (e2) throw e2;
  if (!tx || !inv) throw new Error("거래 또는 계산서를 찾을 수 없습니다.");
  const remaining = Math.abs(Number(inv.total_amount || 0)) - Math.abs(Number(inv.settled_amount || 0));
  const amt = Math.min(Math.abs(Number(tx.amount || 0)), Math.max(remaining, 0));
  if (!(amt > 0)) throw new Error("계산서에 남은 금액이 없습니다.");
  const { data: row, error } = await (supabase as any).from("invoice_settlements").insert({
    company_id: companyId, bank_transaction_id: bankTxId, tax_invoice_id: invoiceId, amount: amt,
    match_type: amt + 0.5 < remaining || amt + 0.5 < Math.abs(Number(tx.amount || 0)) ? "partial" : "one_to_one",
    match_source: source, status: "suggested", confidence: 1, reason: source === "ai" ? "매칭 제안에서 고름" : "계산서에서 통장 거래를 직접 연결",
  }).select("id").single();
  if (error) throw error;
  //   계산서와 통장 줄을 서로 가리키게(세금·증빙의 '연결됨' 표시·해제가 이걸 본다) · 거래처도 따라온다
  await (supabase as any).from("bank_transactions").update({ tax_invoice_id: invoiceId, ...(inv.partner_id && !tx.partner_id ? { partner_id: inv.partner_id } : {}) }).eq("id", bankTxId);
  return decideSettlement(row.id, "confirmed", companyId, tx.transaction_date);
}

/** 연결 해제 — 이 거래·계산서 사이의 정산을 반려한다(트리거가 정산액·전표를 되돌린다). */
export async function unsettleBankTxFromInvoice(companyId: string, bankTxId: string, invoiceId: string): Promise<number> {
  const { data, error } = await (supabase as any).from("invoice_settlements").update({ status: "rejected" })
    .eq("company_id", companyId).eq("bank_transaction_id", bankTxId).eq("tax_invoice_id", invoiceId).in("status", ["suggested", "confirmed"]).select("id");
  if (error) throw error;
  await (supabase as any).from("bank_transactions").update({ tax_invoice_id: null }).eq("id", bankTxId).eq("tax_invoice_id", invoiceId);
  return (data || []).length;
}
