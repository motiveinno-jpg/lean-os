// 무료 퇴직금 계산기 (2026-08-13) — 검색 유입용 공개 도구 2탄 (1탄: 연차 계산기).
import type { Metadata } from "next";
import SeveranceCalculatorView from "./view";
import { FAQS } from "./faqs";

const SITE = "https://www.owner-view.com";
// 루트 레이아웃 template("%s | 오너뷰")이 접미를 붙이므로 여기엔 브랜드를 안 쓴다
const TITLE = "퇴직금 계산기 — 입사일·월급만 넣으면 예상 퇴직금 자동 계산 (무료)";
const DESC =
  "고용노동부 방식 퇴직금 계산기. 1일 평균임금 × 30일 × (재직일수 ÷ 365)로 예상 퇴직금을 계산합니다. 상여금·연차수당 반영, 회원가입 없이 무료.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  keywords: ["퇴직금 계산기", "퇴직금 계산방법", "평균임금 계산", "퇴직금 지급기준", "알바 퇴직금", "퇴직금 세금"],
  alternates: { canonical: `${SITE}/tools/severance-calculator` },
  openGraph: { type: "website", url: `${SITE}/tools/severance-calculator`, siteName: "오너뷰", locale: "ko_KR", title: TITLE, description: DESC },
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
      <SeveranceCalculatorView />
    </>
  );
}
