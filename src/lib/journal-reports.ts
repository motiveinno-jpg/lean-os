// 재무제표의 단일 원천 — **전표(journal_entries/journal_lines)** (2026-08-11 사장님 지시)
//
//   "손익계산서와 재무상태표에는 전표로 처리된 내역만 반영되게 해줘.
//    그냥 불러오기만 한 내용은 반영되지 않게."
//
//   그동안 두 화면은 통장·세금계산서·카드·직원급여 **원본을 직접** 집계했다. 그러면
//   '아직 장부에 안 올린 것'과 '올린 것'이 섞여 재무제표가 장부와 따로 논다.
//   이제 확정된 전표만 읽는다 — 일반전표·매입매출전표 둘 다, `status='confirmed'` 만.
//
//   ⚠️ 그래서 전표를 안 만든 자료는 재무제표에 **안 나온다**. 그게 이 변경의 목적이고,
//     화면은 "아직 전표로 만들지 않은 자료 N건" 을 배너로 알려 준다(비어 보이는 이유를 말해 준다).

import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { getAccountMap, accountById, type PnlSection } from "@/lib/account-nature";

export type JournalLine = {
  month: string;          // YYYY-MM
  date: string;           // YYYY-MM-DD
  accountId: string;
  code: string | null;      // 계정과목표에 코드가 없을 수도 있다
  name: string;
  nature: string;         // asset | liability | equity | revenue | expense
  section: PnlSection;    // revenue | cogs | opex | nonop_income | nonop_expense | tax | null
  debit: number;
  credit: number;
  //   ── 원장(드릴다운)이 쓰는 것 — 2026-08-12 사장님 지시로 추가 ──
  //   그전엔 계정 정보만 실어 와서, 상세 창의 '거래처' 칸에 **계정 이름**이 들어가 있었다
  //   (지급수수료 13줄이 전부 "지급수수료"). 어느 전표인지도 알 수 없었다.
  entryId: string;
  voucherNo: number | null;
  /** 줄 적요가 있으면 그것, 없으면 전표 적요 */
  memo: string;
  partnerName: string | null;
};

/** 확정 전표의 모든 줄. 재무제표 두 화면이 이것만 본다. */
export async function fetchJournalLines(
  companyId: string, fromDate: string, toDate: string,
): Promise<JournalLine[]> {
  const map = await getAccountMap(companyId);
  const out: JournalLine[] = [];
  const PAGE = 1000;
  for (let page = 0; ; page += 1) {
    const data = logRead("journal-reports:lines", await supabase
      .from("journal_entries")
      .select("id, entry_date, voucher_no, description, journal_lines(account_id, debit, credit, description, partners(name))")
      .eq("company_id", companyId)
      .eq("status", "confirmed")          // ★ 확정된 전표만 — 반려·임시분은 장부가 아니다
      .gte("entry_date", fromDate).lte("entry_date", toDate)
      .order("entry_date")
      .range(page * PAGE, page * PAGE + PAGE - 1));
    const rows = (data as any[]) || [];
    for (const e of rows) {
      const date = String(e.entry_date);
      for (const l of (e.journal_lines || [])) {
        const info = accountById(l.account_id, map);
        if (!info) continue;              // 계정과목표에 없는 줄은 성격을 알 수 없어 뺀다
        out.push({
          month: date.slice(0, 7), date,
          accountId: l.account_id, code: info.code, name: info.name,
          nature: info.nature, section: info.section ?? null,
          debit: Number(l.debit || 0), credit: Number(l.credit || 0),
          entryId: String(e.id),
          voucherNo: e.voucher_no ?? null,
          //   줄 적요가 비면 전표 적요로 — 둘 다 비면 빈 칸(억지로 계정 이름을 넣지 않는다)
          memo: String(l.description || e.description || "").trim(),
          partnerName: (l.partners as any)?.name ?? null,
        });
      }
    }
    if (rows.length < PAGE) break;        // 마지막 쪽
  }
  return out;
}

/** 손익 줄의 금액 — 수익은 대변이 +, 비용은 차변이 + */
export function pnlAmount(l: JournalLine): number {
  return l.nature === "revenue" ? l.credit - l.debit : l.debit - l.credit;
}

/** 재무상태표 잔액 — 자산은 차변이 +, 부채·자본은 대변이 + */
export function bsAmount(l: JournalLine): number {
  return l.nature === "asset" ? l.debit - l.credit : l.credit - l.debit;
}

/** 아직 전표로 만들지 않은 자료 — 재무제표가 비어 보이는 이유를 화면이 말할 수 있게 센다.
 *  ⚠️ 건수는 반드시 count 로 센다(행을 받아 세면 1,000행에서 잘린다). */
export async function countUnposted(
  companyId: string, fromDate: string, toDate: string,
): Promise<{ taxInvoice: number; card: number; bank: number; total: number }> {
  const COUNT = { count: "exact", head: true } as const;
  const [ti, card, bank] = await Promise.all([
    supabase.from("tax_invoices").select("id", COUNT)
      .eq("company_id", companyId).neq("status", "void").is("journal_entry_id", null)
      .gte("issue_date", fromDate).lte("issue_date", toDate),
    supabase.from("card_transactions").select("id", COUNT)
      .eq("company_id", companyId).is("journal_entry_id", null)
      .gte("transaction_date", fromDate).lte("transaction_date", toDate),
    //   통장은 '전표가 없다'가 아니라 '아직 처리 안 했다'가 기준 — 수금 매칭도 처리에 들어간다
    (supabase.from("bank_transactions").select("id", COUNT) as any)
      .eq("company_id", companyId).is("journal_entry_id", null).eq("settlement_status", "open")
      .gte("transaction_date", fromDate).lte("transaction_date", toDate),
  ]);
  const n = (r: any) => Number(r?.count || 0);
  const taxInvoice = n(ti), c = n(card), b = n(bank);
  return { taxInvoice, card: c, bank: b, total: taxInvoice + c + b };
}
