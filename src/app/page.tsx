// OwnerView 랜딩 진입점 — 서버 컴포넌트 (2026-07-27).
//   이전에는 page.tsx 전체가 "use client" 라 (1) 랜딩 전용 metadata 를 export 할 수 없었고
//   (2) 정적 섹션까지 전부 클라이언트 번들에 포함됐다.
//   이제 여기서 metadata / 구조화 데이터(JSON-LD) 를 담당하고, 화면은 LandingPage 가 그린다.
import type { Metadata } from "next";
import LandingPage from "@/components/landing/landing-page";
import { FAQS, PLANS, FOOTER } from "@/components/landing/content";

const SITE = "https://www.owner-view.com";
const TITLE = "중소기업 대표를 위한 AI 올인원 운영 플랫폼 | 오너뷰";
const DESC =
  "현금·프로젝트·세무·급여·전자결재까지, 회사 운영의 모든 것을 하나로. AI 자동화 엔진 4개가 대표가 하던 반복 업무를 대신 처리합니다. 무료로 시작하세요.";
// 카카오톡·페북·슬랙 공유 카드용 — 기존 512x512 로고는 잘리거나 썸네일로 축소됐다.
const OG_IMAGE = { url: "/og-image.png", width: 1200, height: 630, alt: "오너뷰 — 중소기업 대표를 위한 올인원 운영 플랫폼" };

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: SITE },
  openGraph: {
    type: "website",
    url: SITE,
    siteName: "오너뷰",
    locale: "ko_KR",
    title: TITLE,
    description: DESC,
    images: [OG_IMAGE],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC, images: [OG_IMAGE.url] },
};

// 구조화 데이터 — 검색 리치결과(FAQ·가격·회사정보)용.
//   값은 전부 content.ts 단일 출처에서 파생 → 화면과 스키마가 어긋날 수 없다.
function structuredData() {
  const paidPlans = PLANS.filter((p) => p.slug);

  const organization = {
    "@type": "Organization",
    "@id": `${SITE}/#organization`,
    name: "모티브이노베이션",
    alternateName: "오너뷰",
    url: SITE,
    logo: `${SITE}/icon-512.png`,
    email: FOOTER.email,
    address: { "@type": "PostalAddress", streetAddress: FOOTER.addr, addressCountry: "KR" },
  };

  const software = {
    "@type": "SoftwareApplication",
    name: "오너뷰 (OwnerView)",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: DESC,
    url: SITE,
    publisher: { "@id": `${SITE}/#organization` },
    offers: paidPlans.map((p) => ({
      "@type": "Offer",
      name: p.name,
      price: p.price.replace(/,/g, ""),
      priceCurrency: "KRW",
      description: p.period,
      url: `${SITE}/auth?plan=${p.slug}`,
    })),
  };

  const faq = {
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return { "@context": "https://schema.org", "@graph": [organization, software, faq] };
}

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData()) }}
      />
      <LandingPage />
    </>
  );
}
