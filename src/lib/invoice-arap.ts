// 받을 돈·낼 돈 — **세금계산서 잔액 기준**
//
//   결정: 대시보드(6칸 신호·경영 요약·마스터)의 '받을 돈/낼 돈'은 세금계산서 잔액(총액 − 정산액)으로 통일한다.
//     · 이유: 대표가 알고 싶은 건 "누구한테 얼마 받아야 하나" — 계산서를 끊자마자 잡히고, 통장 자동 매칭으로
//       입금되면 바로 줄어든다. 원장(외상매출금 계정) 기준은 전표 처리 상태에 따라 흔들려 이름과 어긋났다.
//     · 미수금 위젯·회수 관리·AI 참모·아침 브리핑이 이미 같은 기준 — 어긋나던 6칸 KPI 하나를 맞춘 것.
//     · 원장(회계) 기준은 분석 › 회계 자료·거래처 원장에 그대로 둔다(lib/ledger-arap 는 그쪽 전용).
//   '30일+' = 거래처 순잔액 중 최근 30일 발행분을 뺀 몫(받은 돈·취소분은 오래된 계산서부터 지운다).
import { fetchPartnerBalances, summarizeBalances } from "@/lib/receivables";

export type InvoiceArAp = { ar: number; ap: number; over30: number; over30Partners: number };

//   계산은 lib/receivables(DB receivables_by_partner) 한 곳 — 거래처 안에서 마이너스 계산서를 상계하고,
//   30일+ 는 순잔액에서 최근 30일 발행분을 뺀 몫(종전엔 양수 계산서만 봐 취소된 원본이 30일+ 로 남았다).
export async function fetchInvoiceArAp(companyId: string): Promise<InvoiceArAp> {
  const [sales, purchase] = await Promise.all([
    fetchPartnerBalances(companyId, "sales"),
    fetchPartnerBalances(companyId, "purchase"),
  ]);
  const ar = summarizeBalances(sales), ap = summarizeBalances(purchase);
  return { ar: ar.total, ap: ap.total, over30: ar.over30, over30Partners: ar.over30Partners };
}
