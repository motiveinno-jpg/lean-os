"use client";

import Link from "next/link";
import { LEGAL_DOC_VERSIONS } from "@/lib/legal";
import { RollingBrandText } from "@/components/brand-logo";

const SECTIONS = [
  {
    id: "1",
    title: "제1조 (목적)",
    content: `본 환불규정은 (주)모티브이노베이션(이하 "회사")이 제공하는 OwnerView 서비스(이하 "서비스")의 유료 이용과 관련하여 결제, 해지, 환불의 조건과 절차를 규정함을 목적으로 합니다. 본 규정에 정하지 않은 사항은 이용약관 및 관계 법령에 따릅니다.`,
  },
  {
    id: "2",
    title: "제2조 (가입과 결제의 관계)",
    content: `1. 회원가입만으로는 어떠한 요금도 청구되지 않습니다. 가입 직후에는 유료 기능이 제공되지 않는 상태입니다.
2. 유료 기능을 이용하려면 서비스 내 "요금제" 화면에서 요금제를 선택하고 결제수단(신용·체크카드)을 등록해야 하며, <b>결제 완료 즉시 요금이 청구되고 이용이 개시</b>됩니다.
3. 결제수단 등록 시 카드 유효성 확인을 위한 0원 승인이 이루어질 수 있으며, 이는 실제 청구가 아닙니다.`,
  },
  {
    id: "3",
    title: "제3조 (무료 요금제)",
    content: `1. 무료 요금제는 결제수단 등록 없이 기간 제한 없이 이용할 수 있으며, 어떠한 요금도 청구되지 않습니다.
2. 별도의 무료체험 기간은 제공되지 않습니다. 유료 요금제(오너뷰)는 결제 완료 즉시 요금이 청구되고 이용이 개시됩니다.
3. 유료 요금제 결제 전까지는 무료 요금제의 기능 범위가 적용됩니다.`,
  },
  {
    id: "4",
    title: "제4조 (요금제와 결제 주기)",
    content: `1. 유료 요금제는 <b>오너뷰</b> 단일 요금제이며, 결제 주기는 <b>월간</b> 또는 <b>연간</b> 중 선택할 수 있습니다.
2. 월간 결제는 매월 같은 날 자동 갱신되어 1개월분이 청구됩니다.
3. 연간 결제는 <b>1년치 요금 전액이 최초 1회 일시 청구</b>되며, 월간 정가 대비 <b>10% 할인</b>이 적용됩니다. 이후 매년 같은 날 자동 갱신됩니다.
4. 요금제에는 기본 좌석 5명이 포함되며, 기본 좌석을 초과하는 인원에 대해서는 좌석당 추가 요금이 동일한 결제 주기로 합산 청구됩니다.
5. 모든 표시 금액은 부가가치세(VAT) 10%가 별도이며, 결제 시 합산 청구됩니다.
6. 종전 요금제(프로·울트라·엔터프라이즈)를 이용 중인 회원은 해지 전까지 기존 조건이 그대로 유지되며, 엔터프라이즈는 계약서에 정한 조건이 본 규정에 우선합니다.`,
  },
  {
    id: "5",
    title: "제5조 (해지)",
    content: `1. 회원은 서비스 내 "요금제" 화면 또는 결제 관리 페이지에서 <b>언제든지</b> 구독을 해지할 수 있습니다. 해지에 별도의 위약금은 없습니다.
2. 해지를 신청하면 <b>이미 결제한 이용기간이 끝날 때까지 서비스를 그대로 계속 이용할 수 있습니다.</b> 해지 즉시 이용이 중단되지 않습니다.
3. 결제한 이용기간이 만료되면 자동 갱신 없이 유료 이용이 종료되고 무료 상태로 전환됩니다.
4. 해지 신청 이후 이용기간 만료 전에는 해지를 취소하여 구독을 계속 유지할 수 있습니다.`,
  },
  {
    id: "6",
    title: "제6조 (환불)",
    content: `<b>[월간 결제]</b>
이미 결제된 해당 월의 요금은 환불되지 않습니다. 대신 제5조에 따라 결제한 1개월이 끝날 때까지 서비스를 계속 이용할 수 있습니다.

<b>[연간 결제]</b>
이미 결제된 1년치 요금은 <b>중도 해지 시에도 환불되지 않는 것을 원칙으로 합니다.</b> 대신 결제한 1년의 <b>잔여기간 동안 추가 비용 없이 서비스를 그대로 계속 이용</b>할 수 있으며, 기간 만료 시 자동 갱신 없이 종료됩니다. 연간 결제를 선택하기 전 이 조건을 반드시 확인하시기 바랍니다.
다만 제7조(청약철회)에 해당하거나 제8조(회사 귀책)에 해당하는 경우, 그 밖에 관계 법령에서 환불을 요구하는 경우에는 <b>법령이 본 항에 우선하여 적용</b>됩니다.

<b>[공통]</b>
1. 위 규정에도 불구하고 제7조(청약철회) 또는 제8조(회사 귀책)에 해당하는 경우에는 환불됩니다.
2. 프로모션·할인이 적용된 결제의 환불 기준 금액은 정가가 아닌 <b>실제 결제 금액</b>입니다.
3. 엔터프라이즈 요금제는 계약서에 정한 환불 조건을 우선 적용합니다.`,
  },
  {
    id: "7",
    title: "제7조 (청약철회)",
    content: `1. 「전자상거래 등에서의 소비자보호에 관한 법률」이 적용되는 회원은 결제일로부터 <b>7일 이내</b>에 청약철회를 요청할 수 있습니다.
2. 다만 「전자상거래 등에서의 소비자보호에 관한 법률」 제17조 제2항에 따라, 회원이 결제 후 유료 기능을 실제로 사용하여 그 가치가 현저히 감소한 경우 등 법령에서 정한 사유에 해당하면 청약철회가 제한될 수 있습니다. 이 경우에도 회사는 <b>이용하지 않은 기간에 상당하는 금액</b>의 환불 여부를 개별적으로 검토합니다.
3. 서비스는 사업자를 주된 대상으로 하나, 회원이 「소비자기본법」상 소비자에 해당하는 경우에는 <b>관계 법령이 본 규정보다 우선</b>합니다. 본 규정의 어떠한 내용도 회원에게 법령상 보장된 권리를 배제하거나 제한하지 않습니다.`,
  },
  {
    id: "8",
    title: "제8조 (회사 귀책에 의한 환불)",
    content: `1. 회사의 귀책사유로 서비스를 정상적으로 이용할 수 없었던 경우, 회사는 이용 불가 기간에 비례하여 <b>서비스 이용기간을 연장</b>하는 방식으로 보상합니다.
2. 이용기간 연장이 곤란하거나 회원이 원하지 않는 경우에는 이용 불가 기간에 해당하는 금액을 환불합니다.
3. 정기 점검, 회원의 통신 환경, 회원의 귀책사유, 천재지변 등 회사의 합리적 통제 범위를 벗어난 사유로 인한 중단은 위 보상 대상에서 제외됩니다.`,
  },
  {
    id: "9",
    title: "제9조 (환불이 제한되는 경우)",
    content: `다음의 경우에는 환불이 제한됩니다.
1. 회원이 이용약관을 위반하여 이용이 중지되거나 이용계약이 해지된 경우
2. 부정한 방법으로 서비스를 이용하거나 결제한 경우
3. 제3자의 부정 결제가 의심되는 경우 — 이 경우 사실 확인을 위해 수사기관의 확인 자료가 필요할 수 있습니다.

위 각 호에도 불구하고, 관계 법령에서 환불을 보장하는 경우에는 법령이 우선합니다.`,
  },
  {
    id: "10",
    title: "제10조 (환불 절차)",
    content: `1. 환불이 필요한 경우 아래로 신청합니다.
  - 이메일: creative@mo-tive.com (제목에 "[환불요청]" 표기)
2. 신청 시 다음 정보를 포함해 주십시오.
  가. 회사명 및 신청자 성명
  나. 가입 이메일 주소
  다. 결제 요금제·결제 주기·결제일
  라. 환불 사유
3. 회사는 접수일로부터 <b>7영업일 이내</b>에 환불 여부와 사유를 회신합니다.
4. 환불이 승인되면 결제에 사용된 카드로 승인취소 처리됩니다. 결제는 결제대행사(Stripe)를 통해 이루어지므로 회사가 결제대행사에 환불을 요청하면 결제대행사가 카드사로 전달합니다. <b>회원이 카드사에 직접 요청할 필요는 없습니다.</b>
5. 실제 카드 승인취소 반영까지는 카드사·발급은행의 정산 절차에 따라 영업일 기준 3~7일이 추가로 소요될 수 있으며, 이미 청구된 명세서가 아닌 다음 달 명세서에 반영될 수 있습니다.`,
  },
  {
    id: "11",
    title: "제11조 (분쟁 해결)",
    content: `1. 환불과 관련한 분쟁은 회사와 회원이 우선 상호 협의를 통해 해결합니다.
2. 협의가 이루어지지 않는 경우 한국소비자원 또는 전자거래분쟁조정위원회에 조정을 신청할 수 있습니다.
3. 조정이 이루어지지 않는 경우 서울중앙지방법원을 제1심 관할법원으로 합니다.
4. 본 규정은 대한민국 법률에 따라 해석·적용됩니다.`,
  },
  {
    id: "12",
    title: "제12조 (규정의 변경)",
    content: `1. 회사는 관련 법률을 위배하지 않는 범위에서 본 규정을 변경할 수 있습니다.
2. 변경 시 시행일 30일 전에 서비스 내 공지사항 또는 이메일로 안내합니다.
3. 변경된 규정은 시행일 이후 새로 체결되는 계약부터 적용되며, 이미 결제된 이용기간에는 결제 시점의 규정이 적용됩니다.`,
  },
];

/* 요약 — 본문(제2조~제6조)과 반드시 일치시킬 것 */
const SUMMARY = [
  { plan: "무료", price: "0원 (카드 등록 없이 계속 이용)", refund: "청구 자체가 없음" },
  { plan: "오너뷰 (월간)", price: "39,000원 / 월 (VAT 별도) · 기본 5명 포함, 추가 1명당 5,000원", refund: "언제든 해지 · 결제한 1개월 만료까지 이용 · 당월분 환불 없음" },
  { plan: "오너뷰 (연간)", price: "421,200원 / 년 (VAT 별도, 월간 대비 10% 할인) · 기본 5명 포함", refund: "언제든 해지 · 환불 없음 · 결제한 1년 잔여기간 그대로 이용" },
  { plan: "충전 (발행·AI 토큰)", price: "발행 300원/건 · AI 토큰 50만개 10,000원 (VAT 별도)", refund: "결제 즉시 잔액 적립 · 사용 개시된 충전분은 환불 불가" },
  { plan: "종전 요금제 (프로·울트라·엔터프라이즈)", price: "가입 당시 조건 유지", refund: "해지 전까지 기존 조건 그대로" },
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
          <p className="text-slate-400 text-sm">{`시행일: ${LEGAL_DOC_VERSIONS.refund}`}</p>
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
              {/* 본문은 이 파일 안의 상수(SECTIONS)뿐이며 사용자 입력이 섞이지 않는다.
                  환불 조건은 눈에 띄어야 하는 고지 사항이라 <b> 강조만 허용해 렌더한다. */}
              <div
                className="text-slate-300 text-sm leading-7 whitespace-pre-line"
                dangerouslySetInnerHTML={{ __html: s.content }}
              />
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
