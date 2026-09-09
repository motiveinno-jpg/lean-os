// OwnerView 랜딩 진입점 — 서버 컴포넌트.
//   2026-09-07: v7 을 정식 랜딩으로 올렸다(그전에는 `/landing-v7` 시안, `/` 는 v6).
//   2026-09-09: **v8 로 바꿨다** — 오두 홈 뼈대를 실측해 만든 목업(landing-v11)을 그대로 옮긴 판.
//               사장님 "아까 만들었던 랜딩페이지 목업 메인 랜딩페이지에 배포해줘".
//   ▸ metadata / 구조화 데이터(JSON-LD) 는 여기서, 화면은 LandingV8 이 그린다.
//   ▸ `/landing-v7` 은 여기로 영구(308) 넘긴다 — 같은 화면이 두 주소로 뜨면 중복 문서가 된다.
//   ⚠️ 되돌리려면 아래 import 두 줄과 <LandingV8 /> 을 landing-v7 로 되돌리면 된다.
//      v7 파일(`src/components/landing-v7/**`, `src/app/landing-v7.css`)은 그대로 남겨 두었다.
//   ⚠️ v6 랜딩 파일(`src/components/landing/**`)도 지우지 않았다.
//      `/demo` `/features` `/ai` `/pricing` `/tools` 가 아직 그 content.ts 를 쓴다.
import type { Metadata } from "next";
import LandingV8 from "@/components/landing-v8/landing-v8";
import { FEATS, FOOTER, MENUS, PRICING } from "@/components/landing-v8/content";

const SITE = "https://www.owner-view.com";

// SEO · 2026-09-07 사장님 확정값(목업 머리주석)을 그대로 옮겼다.
const TITLE = "오너뷰 | 회사 운영의 모든 것, 올인원 AI ERP";
const DESC = "통장·카드 자동 수집부터 전표·부가세 신고, 근태·급여, 재고·이커머스까지 한 곳에서.";
const OG_IMAGE = { url: "/og-image.png", width: 1200, height: 630, alt: "오너뷰 · 회사 운영의 모든 것, 올인원 AI ERP" };

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  keywords: [
    "중소기업 ERP", "올인원 ERP", "AI ERP", "회계 프로그램", "세무 신고", "부가세 신고",
    "급여 프로그램", "근태관리", "전자계약", "재고관리 프로그램", "이커머스 연동",
    "스마트스토어 연동", "쿠팡 연동", "프로젝트 관리", "그룹웨어", "사내 메신저",
  ],
  alternates: { canonical: SITE },
  openGraph: {
    type: "website", url: SITE, siteName: "오너뷰", locale: "ko_KR",
    title: TITLE, description: DESC, images: [OG_IMAGE],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC, images: [OG_IMAGE.url] },
};

// 구조화 데이터 · 값은 content.ts 단일 출처에서 파생하므로 화면과 어긋날 수 없다.
function structuredData() {
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

  const product = {
    "@type": "SoftwareApplication",
    name: "오너뷰",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: DESC,
    url: SITE,
    // 화면에 실제로 있는 것만 적는다 — 대표 기능 아홉 + 메뉴 서른둘
    featureList: [...FEATS.map(([, title]) => title), ...MENUS.map(([name]) => name)],
    offers: [
      {
        "@type": "Offer", name: PRICING.free.name, price: "0", priceCurrency: "KRW",
        description: PRICING.free.features.join(" · "),
        url: `${SITE}/auth`,
      },
      {
        "@type": "Offer", name: PRICING.paid.name, price: String(PRICING.amount), priceCurrency: "KRW",
        description: PRICING.note,
        url: `${SITE}/auth`,
      },
    ],
    publisher: { "@id": `${SITE}/#organization` },
  };

  return { "@context": "https://schema.org", "@graph": [organization, product] };
}

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData()) }}
      />
      <LandingV8 />
    </>
  );
}
