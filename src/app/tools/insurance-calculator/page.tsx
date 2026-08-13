// 무료 4대보험 계산기 (2026-08-13) — 검색 유입용 공개 도구 3탄 (1탄 연차, 2탄 퇴직금).
import type { Metadata } from "next";
import InsuranceCalculatorView from "./view";
import { FAQS } from "./faqs";

const SITE = "https://www.owner-view.com";
// 루트 레이아웃 template("%s | 오너뷰")이 접미를 붙이므로 여기엔 브랜드를 안 쓴다
const TITLE = "4대보험 계산기 (2026년 요율) — 직원 공제액 · 회사 부담 총액 자동 계산";
const DESC =
  "2026년 요율 기준 4대보험 계산기. 국민연금 9.5%·건강보험 7.19%·장기요양·고용보험을 직원 부담과 회사 부담으로 나눠 계산하고, 채용 시 회사가 실제 부담하는 총 인건비까지 보여줍니다. 무료.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  keywords: ["4대보험 계산기", "4대보험 요율 2026", "국민연금 계산기", "건강보험료 계산", "고용보험 계산", "직원 채용 비용", "사업주 부담 보험료"],
  alternates: { canonical: `${SITE}/tools/insurance-calculator` },
  openGraph: { type: "website", url: `${SITE}/tools/insurance-calculator`, siteName: "오너뷰", locale: "ko_KR", title: TITLE, description: DESC },
};

export default function Page() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <InsuranceCalculatorView />
    </>
  );
}
