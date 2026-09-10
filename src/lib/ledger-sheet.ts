// 거래처 원장의 "무엇을 세는가" — 좌측 목록·우측 시트·엑셀·상세 창·회계 자료가 전부 이 한 벌을 쓴다.
//   계산서: 무효·초안이 아니고 전표처리된 것(승인번호 유무는 보지 않는다 — 수기 매입 계산서도 전표까지 쳤으면 채권·채무다).
//   수기 전표: 계산서가 가리키는 전표(tax_invoices.journal_entry_id)는 계산서 줄로 이미 세므로 뺀다 — reference_type 으로 가르면
//   매입매출전표에서 만든 초안 계산서를 나중에 발행했을 때 같은 건이 두 번 잡혔다.
//   전기이월: 기간 시작 전의 계산서·정산·수기 전표를 전부 더한다(수기 전표는 기간 안만 읽어 전년도 전표가 이월에서 빠졌었다).
import { supabase } from "@/lib/supabase";
import { fetchPaged } from "@/lib/fetch-paged";
import { logRead } from "@/lib/log-read";

const db = supabase as any;

/** 계산서가 가리키는 전표 id — 이 전표들은 계산서 줄로 세므로 수기 전표에서 뺀다 */
export async function fetchInvoiceLinkedEntryIds(companyId: string): Promise<Set<string>> {
  const rows = await fetchPaged<any>("ledger-sheet:linked", () => db.from("tax_invoices")
    .select("journal_entry_id").eq("company_id", companyId).not("journal_entry_id", "is", null).order("journal_entry_id"), 100000);
  return new Set(((rows || []) as any[]).map((r) => r.journal_entry_id as string));
}

/** 원장에 세는 계산서 조건 — 무효·초안 제외, 전표처리된 것만 */
export function ledgerInvoiceFilter<T>(qb: T): T {
  return (qb as any).neq("status", "void").neq("status", "draft").not("journal_entry_id", "is", null);
}

export type LedgerSheetData = { invoices: any[]; settles: any[]; manualVouchers: any[] };

/** 시트·엑셀 공용: 거래처 하나의 계산서·확정 정산·수기 전표(기간 종료일까지 전부 — 이월 계산용) */
export async function fetchLedgerSheetData(companyId: string, partnerId: string | null, type: string, yEnd: string): Promise<LedgerSheetData> {
  const invoices = await fetchPaged<any>("ledger-sheet:invoices", () => {
    const qb = ledgerInvoiceFilter(db.from("tax_invoices")
      .select("id, issue_date, item_name, label, total_amount, journal_entry_id, journal_entries!tax_invoices_journal_entry_id_fkey(voucher_no)")
      .eq("company_id", companyId).eq("type", type))
      .lte("issue_date", yEnd)
      .order("issue_date", { ascending: true }).order("id");
    return partnerId ? qb.eq("partner_id", partnerId) : qb.is("partner_id", null);
  }, 50000);
  const invRows = (invoices || []) as any[];

  const invIds = invRows.map((i) => i.id);
  let settles: any[] = [];
  if (invIds.length > 0) {
    const { chunkedIn } = await import("@/lib/chunked-in");
    const setts = await chunkedIn((ids) => db.from("invoice_settlements")
      .select("id, tax_invoice_id, amount, match_type, adjustment_reason, bank_transaction_id, created_at")
      .eq("status", "confirmed").in("tax_invoice_id", ids).then((r: any) => logRead("ledger-sheet:setts", r)), invIds);
    const btIds = [...new Set(((setts || []) as any[]).map((s) => s.bank_transaction_id).filter(Boolean))] as string[];
    const btMap: Record<string, { date: string; cp: string | null }> = {};
    if (btIds.length) {
      const bts = await chunkedIn((ids) => db.from("bank_transactions").select("id, transaction_date, counterparty").in("id", ids).then((r: any) => logRead("ledger-sheet:bts", r)), btIds);
      for (const b of (bts || []) as any[]) btMap[b.id] = { date: b.transaction_date, cp: b.counterparty };
    }
    settles = ((setts || []) as any[]).map((s) => ({
      ...s,
      date: s.bank_transaction_id ? (btMap[s.bank_transaction_id]?.date || String(s.created_at).slice(0, 10)) : String(s.created_at).slice(0, 10),
      cp: s.bank_transaction_id ? btMap[s.bank_transaction_id]?.cp : null,
    }));
  }

  let manualVouchers: any[] = [];
  if (partnerId) {
    const [mv, linked] = await Promise.all([
      fetchPaged<any>("ledger-sheet:mv", () => db.from("journal_entries")
        .select("id, entry_date, description, voucher_no, reference_type, journal_lines(debit, credit, partner_id, description, chart_of_accounts(code))")
        .eq("company_id", companyId).eq("source", "manual").eq("status", "confirmed")
        .lte("entry_date", yEnd)
        .order("entry_date", { ascending: true }).order("voucher_no", { ascending: true }).order("id"), 50000),
      fetchInvoiceLinkedEntryIds(companyId),
    ]);
    manualVouchers = ((mv || []) as any[]).filter((e) => !linked.has(e.id) && (e.journal_lines || []).some((l: any) => l.partner_id === partnerId));
  }
  return { invoices: invRows, settles, manualVouchers };
}
