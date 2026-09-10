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
import { daysSinceKst } from "@/lib/kst";
import { ledgerInvoiceFilter } from "@/lib/ledger-sheet";

const db = supabase as any;

export type InvoiceArAp = { ar: number; ap: number; over30: number; over30Partners: number };

export async function fetchInvoiceArAp(companyId: string): Promise<InvoiceArAp> {
  //   원장과 같은 포함 기준(무효·초안·취소 제외, 전표처리된 것) — 화면마다 다른 '미수금' 이 나오던 뿌리
  const rows = await fetchPaged<any>("invoice-arap:rows", () => ledgerInvoiceFilter(db.from("tax_invoices")
    .select("type, total_amount, supply_amount, settled_amount, issue_date, status, counterparty_name")
    .eq("company_id", companyId)).neq("status", "cancelled").order("issue_date").order("id"), 50000);
  let ar = 0, ap = 0, over30 = 0; const overPartners = new Set<string>();
  for (const r of ((rows || []) as any[])) {
    const bal = Number(r.total_amount || r.supply_amount || 0) - Number(r.settled_amount || 0);
    //   마이너스(수정·환입) 계산서는 원본을 상계해야 한다 — 건너뛰면 계약 해제 뒤에도 받을 돈이 그대로였다
    if (Math.abs(bal) <= 1) continue;
    if (r.type === "purchase") { ap += bal; continue; }
    if (r.type !== "sales") continue;
    ar += bal;
    if (bal <= 0) continue;
    const days = r.issue_date ? daysSinceKst(String(r.issue_date)) : 0;
    if (days > 30) { over30 += bal; overPartners.add(r.counterparty_name || "(미상)"); }
  }
  return { ar, ap, over30, over30Partners: overPartners.size };
}
