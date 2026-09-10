// 받을 돈·낼 돈 — 화면마다 제각각이던 미수·미지급 숫자의 **단일 기준** (2026-09-01 전수점검 ①)
//
//   왜 이 모양이었나: 대시보드·경영요약은 원장 RPC만 합산(수동 전표 보정 누락 → 0 표시),
//   마스터는 딜 엔진 자체 계산, 원장 화면은 RPC + 수동 전표 AR/AP 보정 — 네 화면이 네 숫자를 냈다.
//   기준(결정): '받을 돈/낼 돈'은 **거래처 원장 화면과 같은 식** 하나로 통일한다 —
//     잔액 = 원장 RPC(get_partner_ledger_by_year: 발행·전표처리분 이월+당기 잔액)
//          + 수동 확정 전표의 외상매출금(108)/외상매입금(251) 라인 보정, 거래처별 음수는 0으로.
//   '30일+ 연체'는 원장 에이징과 같은 기준 — 전표처리된 발행 세금계산서 잔액을 발행일 경과로 버킷팅.
//   (에이징은 발행분 기준이라 원장 총액과 다를 수 있음 — 원장 화면도 같은 각주를 단다.)
import { daysSinceKst } from "@/lib/kst";
import { fetchInvoiceLinkedEntryIds, ledgerInvoiceFilter } from "@/lib/ledger-sheet";
import { supabase } from "@/lib/supabase";
import { fetchPaged } from "@/lib/fetch-paged";
import { todayKst, kstDateStr } from "@/lib/kst";

const db = supabase as any;

export type LedgerArAp = { ar: number; ap: number; over30: number; over30Partners: number };

export async function fetchLedgerArAp(companyId: string): Promise<LedgerArAp> {
  const year = Number(todayKst().slice(0, 4));
  const since = new Date(); since.setDate(since.getDate() - 730);
  const [rpc, manual, inv] = await Promise.all([
    (db as any).rpc("get_partner_ledger_by_period", { p_from: `${year}-01-01`, p_to: `${year}-12-31` }),
    //   연말까지 전부(전년도 수기 전표도 이월에 든다) · 페이징 필수
    fetchPaged<any>("ledger-arap:manual", () => db.from("journal_entries")
      .select("id, reference_type, journal_lines(partner_id, debit, credit, chart_of_accounts(code))")
      .eq("company_id", companyId).eq("source", "manual").eq("status", "confirmed")
      .lte("entry_date", `${year}-12-31`).order("entry_date").order("id"), 50000),
    fetchPaged<any>("ledger-arap:aging", () => ledgerInvoiceFilter(db.from("tax_invoices")
      .select("total_amount, supply_amount, settled_amount, issue_date, status, counterparty_name")
      .eq("company_id", companyId).eq("type", "sales"))
      .gte("issue_date", kstDateStr(since)).order("issue_date").order("id"), 50000),
  ]);
  const linked = await fetchInvoiceLinkedEntryIds(companyId);

  //   거래처별 잔액 = RPC(이월+당기) + 수동 전표 보정 — 합산 후 음수는 0 (원장 좌측 목록과 같은 취급)
  const per = new Map<string, { sales: number; purchase: number }>();
  const bump = (pid: string | null, type: "sales" | "purchase", v: number) => {
    const k = pid || "none";
    const cur = per.get(k) || { sales: 0, purchase: 0 };
    cur[type] += v;
    per.set(k, cur);
  };
  for (const r of ((rpc.data || []) as any[])) {
    bump(r.partner_id, r.type === "sales" ? "sales" : "purchase",
      Number(r.prior_outstanding || 0) + Number(r.period_outstanding || 0));
  }
  for (const e of ((manual || []) as any[])) {
    //   세금계산서 자동 전표(reference_type='tax_invoice')는 RPC 가 이미 계산서로 세므로 제외(중복합산 방지, 2026-09-09).
    if (linked.has(e.id)) continue;   // 계산서가 가리키는 전표는 계산서 줄로 이미 센다
    for (const l of (e.journal_lines || [])) {
      if (!l.partner_id) continue;
      const code = l.chart_of_accounts?.code;
      const d = Number(l.debit || 0), c = Number(l.credit || 0);
      if (code === "108") bump(l.partner_id, "sales", d - c);      // 외상매출금: 차변 증가
      if (code === "251") bump(l.partner_id, "purchase", c - d);   // 외상매입금: 대변 증가
    }
  }
  let ar = 0, ap = 0;
  for (const v of per.values()) { ar += Math.max(0, v.sales); ap += Math.max(0, v.purchase); }

  //   30일+ 연체 — 원장 에이징(31일부터)과 같은 계산
  let over30 = 0; const overPartners = new Set<string>();
  for (const r of ((inv || []) as any[])) {
    const bal = Number(r.total_amount || r.supply_amount || 0) - Number(r.settled_amount || 0);
    if (bal <= 1) continue;
    const days = r.issue_date ? daysSinceKst(String(r.issue_date)) : 0;
    if (days > 30) { over30 += bal; overPartners.add(r.counterparty_name || "(미상)"); }
  }
  return { ar, ap, over30, over30Partners: overPartners.size };
}
