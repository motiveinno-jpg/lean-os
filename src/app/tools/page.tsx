// 무료 계산기 허브 페이지 /tools (2026-08-31 SEO 정비) — 6개 계산기 색인 표면 확대.
//   "무료 계산기 / 노무 계산기 모음" 검색어를 받고, 각 도구로 내부링크를 나눠 색인을 돕는다.
import type { Metadata } from "next";
import ToolsHubView from "./view";
import { SITE, TOOLS } from "./_seo";

const TITLE = "무료 계산기 모음 — 연차·퇴직금·4대보험·실수령액·주휴수당·부가세";
const DESC =
  "사장님·인사담당자를 위한 무료 계산기 모음. 연차, 퇴직금, 4대보험, 월급 실수령액, 주휴수당, 부가세를 회원가입 없이 한 곳에서 계산하세요. 2026년 요율·최저임금 기준.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  keywords: ["무료 계산기", "노무 계산기", "급여 계산기", "인사 계산기 모음", "연차 계산기", "퇴직금 계산기", "4대보험 계산기", "실수령액 계산기", "주휴수당 계산기", "부가세 계산기"],
  alternates: { canonical: `${SITE}/tools` },
  openGraph: { type: "website", url: `${SITE}/tools`, siteName: "오너뷰", locale: "ko_KR", title: TITLE, description: DESC },
};

export default function Page() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${SITE}/tools#page`,
        name: TITLE,
        url: `${SITE}/tools`,
        description: DESC,
        inLanguage: "ko-KR",
        isPartOf: { "@type": "WebSite", name: "오너뷰", url: SITE },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "오너뷰", item: `${SITE}/` },
          { "@type": "ListItem", position: 2, name: "무료 계산기", item: `${SITE}/tools` },
        ],
      },
      {
        "@type": "ItemList",
        name: "무료 계산기",
        itemListElement: TOOLS.map((t, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: t.name,
          url: `${SITE}/tools/${t.slug}`,
        })),
      },
    ],
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <ToolsHubView />
    </>
  );
}
