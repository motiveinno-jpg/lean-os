// 무료 부가세 계산기 (2026-08-25) — 검색 유입용 공개 도구 6탄.
//   부가가치세 10% · 공급가액↔합계금액 양방향. 계산 로직은 view.tsx.
import type { Metadata } from "next";
import VatCalculatorView from "./view";
import { FAQS } from "./faqs";
import { toolJsonLd } from "../_seo";

const SITE = "https://www.owner-view.com";
// 루트 레이아웃 template("%s | 오너뷰")이 접미를 붙이므로 여기엔 브랜드를 안 쓴다
const TITLE = "부가세 계산기 — 공급가액·합계금액 부가가치세 10% 자동 계산";
const DESC =
  "금액만 넣으면 부가가치세(10%)를 계산하는 무료 부가세 계산기. 공급가액 기준으로 부가세를 더하거나, 부가세 포함 합계금액에서 공급가액·세액을 역산합니다. 세금계산서 발행에 그대로 활용하세요.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  keywords: ["부가세 계산기", "부가가치세 계산", "부가세 계산", "공급가액 계산", "부가세 포함 계산", "부가세 역산", "세금계산서 부가세"],
  alternates: { canonical: `${SITE}/tools/vat-calculator` },
  openGraph: { type: "website", url: `${SITE}/tools/vat-calculator`, siteName: "오너뷰", locale: "ko_KR", title: TITLE, description: DESC },
};

export default function Page() {
  const jsonLd = toolJsonLd({ slug: "vat-calculator", name: "부가세 계산기", desc: DESC, faqs: FAQS });
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <VatCalculatorView />
    </>
  );
}
