// 랜딩 v7 진입점 — 서버 컴포넌트 (2026-09-04).
//   기획: docs/20260904_PLAN_landing_v7_odoo_benchmark.md
//   ▸ 현재 랜딩(`/`, LandingPage)은 그대로 둔다. v7 은 사장님이 고르실 때까지 별도 라우트다.
//   ▸ metadata·구조화 데이터는 여기서, 화면은 LandingV7 이 그린다.
//   ⚠️ 확정 전까지 검색엔진에 걸리지 않게 noindex 다. 정식 전환 때 robots 를 빼고
//      `/` 로 옮기면서 canonical 을 SITE 로 바꾼다.
import type { Metadata } from "next";
import LandingV7 from "@/components/landing-v7/landing-v7";
import { PRICING, SECTIONS, FOOTER } from "@/components/landing-v7/content";

const SITE = "https://www.owner-view.com";

// SEO — 제목·설명은 랜딩 본문의 키워드와 같은 말을 쓴다 (결정 190).
const TITLE = "중소기업 ERP 오너뷰 — 매출 KPI·판매채널 연동·회계·세무 신고·급여까지 올인원 AI ERP";
const DESC =
  "매출 KPI 대시보드, 스마트스토어·쿠팡 주문 연동, 프로젝트 업무관리, 공용 캘린더, 대용량 파일 보관, " +
  "근태관리·급여명세서, 회계 ERP·부가세 신고, 사내 매뉴얼 게시판, 사내 메신저. " +
  "따로 쓰던 프로그램을 오너뷰 하나로. 회사당 월 39,000원, 기본 기능은 계속 무료입니다.";
const OG_IMAGE = { url: "/og-image.png", width: 1200, height: 630, alt: "오너뷰 — 회사 운영의 모든 것, 올인원 AI ERP" };

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  keywords: [
    "중소기업 ERP", "올인원 ERP", "AI ERP", "회계 프로그램", "세무 신고", "부가세 신고",
    "급여 프로그램", "근태관리", "전자계약", "재고관리 프로그램", "이커머스 연동",
    "스마트스토어 연동", "쿠팡 연동", "프로젝트 관리", "그룹웨어", "사내 메신저",
  ],
  alternates: { canonical: `${SITE}/landing-v7` },
  robots: { index: false, follow: false },
  openGraph: {
    type: "website", url: `${SITE}/landing-v7`, siteName: "오너뷰", locale: "ko_KR",
    title: TITLE, description: DESC, images: [OG_IMAGE],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC, images: [OG_IMAGE.url] },
};

// 구조화 데이터 — 값은 content.ts 단일 출처에서 파생하므로 화면과 어긋날 수 없다.
function structuredData() {
  const organization = {
    "@type": "Organization",
    "@id": `${SITE}/#organization`,
    name: "모티브이노베이션",
    url: SITE,
    email: FOOTER.email,
    address: { "@type": "PostalAddress", streetAddress: FOOTER.addr, addressCountry: "KR" },
  };

  const product = {
    "@type": "SoftwareApplication",
    name: "오너뷰",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: DESC,
    featureList: SECTIONS.map((s) => s.title.replace(/\n/g, " ")),
    offers: [
      {
        "@type": "Offer", name: "무료", price: "0", priceCurrency: "KRW",
        description: PRICING.free.features.join(" · "),
      },
      {
        "@type": "Offer", name: "오너뷰", price: String(PRICING.amount), priceCurrency: "KRW",
        description: PRICING.paid.note,
      },
    ],
    publisher: { "@id": `${SITE}/#organization` },
  };

  return { "@context": "https://schema.org", "@graph": [organization, product] };
}

export default function LandingV7Page() {
  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData()) }}
      />
      <LandingV7 />
    </>
  );
}
