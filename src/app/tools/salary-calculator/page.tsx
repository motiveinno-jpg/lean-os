// 무료 월급 실수령액 계산기 (2026-08-13) — 검색 유입용 공개 도구 4탄.
//   소득세는 국세청 간이세액표(2026-02-27 개정) 원본 데이터(ganyi-2026.json) 조회 방식.
import type { Metadata } from "next";
import SalaryCalculatorView from "./view";
import { FAQS } from "./faqs";

const SITE = "https://www.owner-view.com";
// 루트 레이아웃 template("%s | 오너뷰")이 접미를 붙이므로 여기엔 브랜드를 안 쓴다
const TITLE = "월급 실수령액 계산기 (2026년) — 4대보험·소득세 공제 후 통장에 들어오는 돈";
const DESC =
  "2026년 기준 연봉·월급 실수령액 계산기. 국세청 간이세액표(2026.2.27 개정) 원본과 4대보험 요율로 국민연금·건강보험·고용보험·소득세·지방소득세를 공제한 실수령액을 계산합니다. 무료.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  keywords: ["실수령액 계산기", "월급 실수령액", "연봉 실수령액 2026", "간이세액표", "근로소득세 계산", "월급 세금 계산"],
  alternates: { canonical: `${SITE}/tools/salary-calculator` },
  openGraph: { type: "website", url: `${SITE}/tools/salary-calculator`, siteName: "오너뷰", locale: "ko_KR", title: TITLE, description: DESC },
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
      <SalaryCalculatorView />
    </>
  );
}
