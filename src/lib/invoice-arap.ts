// 받을 돈·낼 돈 — **세금계산서 잔액 기준** (2026-09-03 사장님 결정)
//
//   결정: 대시보드(6칸 신호·경영 요약·마스터)의 '받을 돈/낼 돈'은 세금계산서 잔액(총액 − 정산액)으로 통일한다.
//     · 이유: 대표가 알고 싶은 건 "누구한테 얼마 받아야 하나" — 계산서를 끊자마자 잡히고, 통장 자동 매칭으로
//       입금되면 바로 줄어든다. 원장(외상매출금 계정) 기준은 전표 처리 상태에 따라 흔들려 이름과 어긋났다.
//     · 미수금 위젯·회수 관리·AI 참모·아침 브리핑이 이미 같은 기준 — 어긋나던 6칸 KPI 하나를 맞춘 것.
//     · 원장(회계) 기준은 분석 › 회계 자료·거래처 원장에 그대로 둔다(lib/ledger-arap 는 그쪽 전용).
//   '30일+' = 발행일 기준 30일 경과한 매출 계산서 잔액(전표 처리 여부와 무관).
import { supabase } from "@/lib/supabase";
import { fetchPaged } from "@/lib/fetch-paged";
import { kstDateStr } from "@/lib/kst";

const db = supabase as any;

export type InvoiceArAp = { ar: number; ap: number; over30: number; over30Partners: number };

export async function fetchInvoiceArAp(companyId: string): Promise<InvoiceArAp> {
  const since = new Date(); since.setDate(since.getDate() - 730);   // 2년 — 그보다 오래된 미정산은 원장에서 다룬다
  const rows = await fetchPaged<any>("invoice-arap:rows", () => db.from("tax_invoices")
    .select("type, total_amount, supply_amount, settled_amount, issue_date, status, counterparty_name")
    .eq("company_id", companyId).neq("status", "void").neq("status", "draft")
    .gte("issue_date", kstDateStr(since)).order("issue_date"), 50000);

  const now = new Date();
  const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let ar = 0, ap = 0, over30 = 0; const overPartners = new Set<string>();
  for (const r of ((rows || []) as any[])) {
    const bal = Number(r.total_amount || r.supply_amount || 0) - Number(r.settled_amount || 0);
    if (bal <= 1) continue;
    if (r.type === "purchase") { ap += bal; continue; }
    if (r.type !== "sales") continue;
    ar += bal;
    const days = r.issue_date ? Math.floor((todayMs - new Date(String(r.issue_date).slice(0, 10)).getTime()) / 86400000) : 0;
    if (days > 30) { over30 += bal; overPartners.add(r.counterparty_name || "(미상)"); }
  }
  return { ar, ap, over30, over30Partners: overPartners.size };
}
