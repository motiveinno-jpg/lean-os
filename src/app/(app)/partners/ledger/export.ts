// 거래처원장 일괄 엑셀 내보내기 — 선택한 거래처들을 한 파일에 거래처별 시트로 저장.
//   행 구성·잔액 계산은 PartnerLedgerSheet(shared.tsx)의 시트/CSV 로직과 동일하게 유지할 것
//   (발생=홈택스 발행 세금계산서, 회수/지급=확정 정산, 수동 전표 AR/AP 라인, 전기이월/월계/합계 행).

import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { ADJ_REASON_LABEL } from "./shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type LedgerExportTarget = { partnerId: string | null; type: string; name: string };

type Entry = { date: string; desc: string; debit: number; credit: number };

async function fetchLedgerEntries(companyId: string, partnerId: string | null, type: string, yStart: string, yEnd: string): Promise<Entry[]> {
  const isSales = type === "sales";

  // 발생: 해당 거래처 세금계산서 (시트와 동일 — 홈택스 발행분만, 전기이월 위해 과거 포함)
  let qb = db.from("tax_invoices")
    .select("id, issue_date, item_name, label, total_amount")
    .eq("company_id", companyId).eq("type", type).neq("status", "void")
    .not("nts_confirm_no", "is", null)
    .lte("issue_date", yEnd)
    .order("issue_date", { ascending: true }).limit(2000);
  qb = partnerId ? qb.eq("partner_id", partnerId) : qb.is("partner_id", null);
  const { data: invoices } = await qb;
  const invRows = (invoices || []) as any[];

  // 회수/지급: 확정 정산 (통장 거래일 기준, 차액마감은 생성일)
  const invIds = invRows.map((i) => i.id);
  let settles: any[] = [];
  if (invIds.length > 0) {
    const { data: setts } = await db.from("invoice_settlements")
      .select("id, tax_invoice_id, amount, match_type, adjustment_reason, bank_transaction_id, created_at")
      .eq("status", "confirmed").in("tax_invoice_id", invIds);
    const btIds = [...new Set(((setts || []) as any[]).map((s) => s.bank_transaction_id).filter(Boolean))];
    const btMap: Record<string, { date: string; cp: string | null }> = {};
    if (btIds.length) {
      const { data: bts } = await db.from("bank_transactions").select("id, transaction_date, counterparty").in("id", btIds);
      for (const b of (bts || []) as any[]) btMap[b.id] = { date: b.transaction_date, cp: b.counterparty };
    }
    settles = ((setts || []) as any[]).map((s) => ({
      ...s,
      date: s.bank_transaction_id ? (btMap[s.bank_transaction_id]?.date || String(s.created_at).slice(0, 10)) : String(s.created_at).slice(0, 10),
      cp: s.bank_transaction_id ? btMap[s.bank_transaction_id]?.cp : null,
    }));
  }

  // 수동 전표 — 이 거래처 라인을 포함한 manual·confirmed 전표 (AR/AP 라인 전부 반영)
  const { data: mv } = await db.from("journal_entries")
    .select("id, entry_date, description, voucher_no, journal_lines(debit, credit, partner_id, description, chart_of_accounts(code))")
    .eq("company_id", companyId).eq("source", "manual").eq("status", "confirmed")
    .gte("entry_date", yStart).lte("entry_date", yEnd)
    .order("entry_date", { ascending: true }).order("voucher_no", { ascending: true });
  const manualVouchers = ((mv || []) as any[]).filter((e) =>
    (e.journal_lines || []).some((l: any) => l.partner_id === partnerId),
  );

  const arApCode = isSales ? "108" : "251";
  const occur = (inv: any): Entry => ({
    date: inv.issue_date,
    desc: `세금계산서 · ${inv.item_name || inv.label || "품목 미상"}`,
    debit: isSales ? Number(inv.total_amount || 0) : 0,
    credit: isSales ? 0 : Number(inv.total_amount || 0),
  });
  const settle = (s: any): Entry => ({
    date: s.date,
    desc: s.match_type === "adjustment"
      ? `차액 마감 (${ADJ_REASON_LABEL[s.adjustment_reason] || "잔액 정리"})`
      : `${isSales ? "입금" : "지급"}${s.cp ? ` · ${s.cp}` : ""}`,
    debit: isSales ? 0 : Number(s.amount || 0),
    credit: isSales ? Number(s.amount || 0) : 0,
  });
  const voucherEntries = (v: any): Entry[] =>
    ((v.journal_lines || []) as any[])
      .filter((l) => l.partner_id === partnerId && l.chart_of_accounts?.code === arApCode)
      .map((l) => ({ date: String(v.entry_date), desc: l.description || v.description || "전표", debit: Number(l.debit || 0), credit: Number(l.credit || 0) }));

  return [...invRows.map(occur), ...settles.map(settle), ...manualVouchers.flatMap(voucherEntries)];
}

// 원장 시트 AOA (일자|적요|차변|대변|잔액 + 전기이월/월계/합계) — CSV 다운로드와 동일 구성, 금액은 숫자 셀.
async function buildSheetRows(companyId: string, t: LedgerExportTarget, yStart: string, yEnd: string): Promise<(string | number)[][]> {
  const isSales = t.type === "sales";
  const all = await fetchLedgerEntries(companyId, t.partnerId, t.type, yStart, yEnd);
  const dir = (e: Entry) => (isSales ? e.debit - e.credit : e.credit - e.debit);
  const before = all.filter((e) => e.date < yStart);
  const within = all.filter((e) => e.date >= yStart && e.date <= yEnd)
    .sort((a, b) => a.date.localeCompare(b.date) || (b.debit + b.credit) - (a.debit + a.credit));
  const opening = before.reduce((s, e) => s + dir(e), 0);

  const rows: (string | number)[][] = [
    [`거래처원장 — ${t.name} (${isSales ? "매출처" : "매입처"})`, `${yStart} ~ ${yEnd}`, "", "", ""],
    ["일자", "적요", "차변", "대변", "잔액"],
    [yStart, "[전기이월]", "", "", Math.round(opening)],
  ];
  let bal = opening;
  let curMonth = "";
  let md = 0, mc = 0;
  const pushMonthTotal = () => { if (curMonth) rows.push([curMonth, "[월계]", Math.round(md), Math.round(mc), ""]); };
  for (const e of within) {
    const m = e.date.slice(0, 7);
    if (m !== curMonth) { pushMonthTotal(); curMonth = m; md = 0; mc = 0; }
    bal += dir(e);
    md += e.debit; mc += e.credit;
    rows.push([e.date, e.desc, e.debit ? Math.round(e.debit) : "", e.credit ? Math.round(e.credit) : "", Math.round(bal)]);
  }
  pushMonthTotal();
  rows.push(["", "[합계]",
    Math.round(within.reduce((s, e) => s + e.debit, 0)),
    Math.round(within.reduce((s, e) => s + e.credit, 0)),
    Math.round(bal)]);
  return rows;
}

// Excel 시트명: 31자 제한 + 금지문자 치환 + 중복 뒤 (2)…
function sheetName(name: string, used: Set<string>): string {
  const base = (name || "미지정").replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 28) || "거래처";
  let n = base; let i = 2;
  while (used.has(n)) n = `${base}(${i++})`.slice(0, 31);
  used.add(n);
  return n;
}

export async function exportPartnerLedgersXlsx(
  companyId: string,
  targets: LedgerExportTarget[],
  yStart: string,
  yEnd: string,
  tabLabel: string,
): Promise<void> {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const t of targets) {
    const rows = await buildSheetRows(companyId, t, yStart, yEnd);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 11 }, { wch: 34 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, sheetName(t.name, used));
  }
  XLSX.writeFile(wb, `거래처원장_${tabLabel}_${yStart}_${yEnd}.xlsx`);
}
