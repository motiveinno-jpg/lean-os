"use client";

import Link from "next/link";
import { RollingBrandText } from "@/components/brand-logo";

const SECTIONS = [
  {
    id: "1",
    title: "제1조 (목적)",
    content: `본 환불규정은 (주)모티브이노베이션(이하 "회사")이 제공하는 OwnerView 서비스(이하 "서비스")의 유료 이용과 관련하여 환불의 조건, 절차, 제한 사항을 규정함을 목적으로 합니다.`,
  },
  {
    id: "2",
    title: "제2조 (무료체험)",
    content: `1. 신규 가입 시 14일간 유료 기능을 무료로 체험할 수 있으며, 체험 기간 중에는 카드 등록이나 결제가 발생하지 않습니다.
2. 무료체험은 결제 없이 진행되므로 환불 대상이 아닙니다.
3. 체험 기간이 종료되면 유료 기능 이용이 제한됩니다. 계속 이용하려면 회원이 직접 요금제를 선택하고 결제를 진행해야 하며, 체험 종료만으로 자동 결제되지 않습니다.`,
  },
  {
    id: "3",
    title: "제3조 (요금제별 환불 규정)",
    content: `모든 유료 요금제는 월 단위 정액 결제이며, 연간 결제 옵션은 제공하지 않습니다.

[1. Free (14일 무료체험)]
- 결제가 발생하지 않으므로 환불 대상이 아닙니다.

[2. 기본요금제 / 울트라]
- 회원은 언제든지 구독을 해지할 수 있습니다.
- 해지 시 다음 결제일부터 청구가 중단되며, 이미 결제된 당월 요금에 대한 환불은 원칙적으로 제공되지 않습니다.
- 해지 후에도 이미 결제한 기간이 만료될 때까지는 서비스를 계속 이용할 수 있습니다.
- 단, 제6조(청약철회)에 해당하는 경우에는 예외적으로 환불됩니다.

[3. 엔터프라이즈]
- 별도 계약 조건에 따르며, 계약서에 명시된 환불 조건을 우선 적용합니다.`,
  },
  {
    id: "4",
    title: "제4조 (환불 절차)",
    content: `1. 환불을 요청하고자 하는 회원은 다음의 방법으로 신청할 수 있습니다.
  - 이메일: creative@mo-tive.com
  - 제목에 "[환불요청]"을 포함하여 주시기 바랍니다.

2. 환불 신청 시 다음 정보를 포함하여야 합니다.
  가. 회사명 및 관리자명
  나. 가입 이메일 주소
  다. 결제 플랜 및 결제일
  라. 환불 사유

3. 회사는 환불 요청을 접수한 날로부터 7영업일 이내에 환불 승인 여부를 통지합니다.

4. 환불이 승인된 경우, 결제에 사용된 카드로 환불 처리합니다. 결제는 결제대행사(Stripe)를 통해 이루어지므로, 회사가 결제대행사에 환불을 요청하면 결제대행사가 카드 발급사(카드사)로 환불을 전달합니다 — 회원이 카드사에 직접 환불을 요청할 필요는 없습니다.

5. 실제 환불(카드 승인취소) 처리까지는 카드사·발급은행의 자체 정산 절차에 따라 영업일 기준 3~7일 정도 추가로 소요될 수 있으며, 신용카드의 경우 이미 청구된 명세서가 아닌 다음 달 명세서에 반영될 수 있습니다.`,
  },
  {
    id: "5",
    title: "제5조 (환불 제한 및 예외)",
    content: `다음의 경우에는 환불이 제한됩니다.

1. 이용약관 위반으로 인하여 서비스 이용이 중지되거나 계약이 해지된 경우
2. 부정한 방법으로 서비스를 이용한 경우
3. 서비스를 상당 부분 이용한 후 환불을 요청하는 경우 (해당 월 서비스 이용일수가 전체의 50% 이상인 경우)
4. 프로모션, 할인 등이 적용된 결제의 경우, 할인 전 금액이 아닌 실제 결제 금액을 기준으로 환불합니다
5. 제3자의 부정 결제로 인한 환불 요청의 경우, 수사기관의 확인이 필요할 수 있습니다
6. 회사의 서비스 장애로 인한 이용 불가의 경우, 장애 기간에 비례한 서비스 기간 연장으로 보상할 수 있으며, 이 경우 금전 환불보다 서비스 기간 연장이 우선 적용됩니다`,
  },
  {
    id: "6",
    title: "제6조 (결제 취소 및 청약 철회)",
    content: `1. 전자상거래 등에서의 소비자보호에 관한 법률에 따라, 유료 서비스 결제일로부터 7일 이내에 청약 철회를 요청할 수 있습니다.
2. 다만, 다음의 경우 청약 철회가 제한됩니다.
  가. 이미 서비스를 이용한 경우 (로그인 후 서비스 기능을 사용한 경우)
  나. 회원의 책임 있는 사유로 서비스가 멸실 또는 훼손된 경우
3. B2B(기업 간 거래) 서비스의 특성상, 사업자 간 거래에는 소비자보호법상 청약 철회 규정이 적용되지 않을 수 있습니다.`,
  },
  {
    id: "7",
    title: "제7조 (분쟁 해결)",
    content: `1. 환불과 관련한 분쟁이 발생한 경우, 회사와 회원은 우선적으로 상호 협의를 통한 원만한 해결을 모색합니다.
2. 협의가 이루어지지 않는 경우, 한국소비자원 또는 전자거래분쟁조정위원회에 조정을 신청할 수 있습니다.
3. 조정이 이루어지지 않는 경우, 서울중앙지방법원을 제1심 관할법원으로 합니다.
4. 본 환불규정은 대한민국 법률에 따라 해석되고 적용됩니다.`,
  },
  {
    id: "8",
    title: "제8조 (규정의 변경)",
    content: `1. 회사는 관련 법률을 위배하지 않는 범위에서 본 환불규정을 변경할 수 있습니다.
2. 변경 시에는 시행일자 30일 전에 서비스 내 공지사항 또는 이메일을 통해 안내합니다.
3. 변경된 규정은 시행일 이후 체결되는 계약부터 적용되며, 기존 계약은 계약 체결 시점의 규정을 따릅니다.`,
  },
];

/* Quick summary table (전 요금제 월 정액 — 연간 결제 없음) */
const SUMMARY = [
  { plan: "Free (14일 무료체험)", price: "0원", refund: "결제 없음 — 환불 대상 아님" },
  { plan: "기본요금제", price: "55,000원 / 월", refund: "언제든 해지 가능, 당월 결제분 환불 없음" },
  { plan: "울트라", price: "88,000원 / 월", refund: "언제든 해지 가능, 당월 결제분 환불 없음" },
  { plan: "엔터프라이즈", price: "별도 협의", refund: "계약서 조건에 따름" },
];

export default function RefundPage() {
  return (
    <div className="min-h-screen bg-[#0A0E1A] text-white">
      {/* Nav */}
      <nav className="refund-nav">
        <div className="max-w-4xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm bg-blue-600">L</div>
            <span className="text-lg font-bold text-white"><RollingBrandText /></span>
          </Link>
          <Link href="/" className="px-4 py-2 text-sm text-slate-300 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition">
            홈으로
          </Link>
        </div>
      </nav>

      {/* Content */}
      <main className="refund-main">
        <div className="mb-12">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">환불규정</h1>
          <p className="text-slate-400 text-sm">최종 수정일: 2026년 7월 13일 | 시행일: 2026년 7월 13일</p>
        </div>

        {/* Summary table */}
        <div className="refund-summary-table">
          <h2 className="text-lg font-semibold mb-4">요약</h2>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left py-3 px-4 text-slate-400 font-medium">플랜</th>
                <th className="text-left py-3 px-4 text-slate-400 font-medium">요금</th>
                <th className="text-left py-3 px-4 text-slate-400 font-medium">환불</th>
              </tr>
            </thead>
            <tbody>
              {SUMMARY.map((r) => (
                <tr key={r.plan} className="border-b border-white/5">
                  <td className="py-3 px-4 font-medium text-white">{r.plan}</td>
                  <td className="py-3 px-4 text-slate-300">{r.price}</td>
                  <td className="py-3 px-4 text-slate-300">{r.refund}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-10">
          {SECTIONS.map((s) => (
            <section key={s.id} className="refund-section">
              <h2 className="text-lg font-semibold text-white mb-3">{s.title}</h2>
              <div className="text-slate-300 text-sm leading-7 whitespace-pre-line">{s.content}</div>
            </section>
          ))}
        </div>

        {/* Supplementary */}
        <div className="refund-supplementary">
          <h3 className="font-semibold mb-3 text-white">부칙</h3>
          <div className="text-slate-300 text-sm leading-7 space-y-1">
            <p>1. 본 규정은 2026년 7월 13일부터 시행합니다.</p>
            <p>2. 본 규정 시행 이전에 결제한 회원의 경우, 결제 시점의 환불 정책이 적용됩니다.</p>
          </div>
        </div>

        {/* Contact */}
        <div className="refund-contact">
          <p className="font-semibold text-white mb-2">환불 문의</p>
          <p>이메일: <a href="mailto:creative@mo-tive.com" className="text-blue-400 hover:underline">creative@mo-tive.com</a></p>
          <p>제목에 <span className="text-white font-medium">[환불요청]</span>을 포함하여 보내주시면 7영업일 이내 처리해 드립니다.</p>
        </div>

        {/* Company info */}
        <div className="refund-company-info">
          <p className="font-semibold text-slate-300">(주)모티브이노베이션</p>
          <p>대표: 채희웅</p>
          <p>소재지: 경기 화성시 동탄구 동탄첨단산업1로 27 IX타워 A동 2514호, 2515호</p>
          <p>이메일: creative@mo-tive.com</p>
        </div>
      </main>

      {/* Footer */}
      <footer className="refund-footer">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-xs">
            <div>(주)모티브이노베이션 | 대표 채희웅 | 경기 화성시 동탄구 동탄첨단산업1로 27 IX타워 A동 2514호, 2515호</div>
            <div className="flex gap-4">
              <Link href="/terms" className="hover:text-white transition">이용약관</Link>
              <Link href="/privacy" className="hover:text-white transition">개인정보처리방침</Link>
              <span className="text-white font-semibold">환불규정</span>
              <a href="mailto:creative@mo-tive.com" className="hover:text-white transition">creative@mo-tive.com</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
