// 무료 계산기 공용 SEO — 도구 목록(단일 출처) + 구조화데이터 생성 (2026-08-31 SEO 정비).
//   목적: 6개 계산기가 네이버·구글에 더 잘 잡히도록 schema.org 구조화데이터를 보강한다.
//   기존엔 FAQPage 만 넣었는데, 도구 페이지엔 WebApplication + BreadcrumbList 를 함께 주는 게
//   검색엔진이 "무료 웹 계산 도구"임을 이해하고 리치 결과로 노출하기에 유리하다.

export const SITE = "https://www.owner-view.com";

export type Tool = { slug: string; name: string; desc: string };

// 허브 페이지(/tools)·사이트맵·크로스링크가 공유하는 단일 목록.
export const TOOLS: Tool[] = [
  { slug: "leave-calculator", name: "연차 계산기", desc: "입사일만 넣으면 발생 연차·연차수당 자동 계산" },
  { slug: "severance-calculator", name: "퇴직금 계산기", desc: "고용노동부 방식 예상 퇴직금 계산" },
  { slug: "insurance-calculator", name: "4대보험 계산기", desc: "직원 공제액·회사 부담 총액 (2026년 요율)" },
  { slug: "salary-calculator", name: "실수령액 계산기", desc: "간이세액표 기준 월급 실수령액 계산" },
  { slug: "weekly-holiday-calculator", name: "주휴수당 계산기", desc: "주 15시간 이상 근로자 주휴수당 (2026 최저임금)" },
  { slug: "vat-calculator", name: "부가세 계산기", desc: "공급가액·합계금액 부가가치세 10% 양방향 계산" },
];

/** 도구 페이지 1장의 구조화데이터(@graph): 웹앱 + 빵부스러기 + FAQ */
export function toolJsonLd({ slug, name, desc, faqs }: {
  slug: string; name: string; desc: string; faqs: { q: string; a: string }[];
}) {
  const url = `${SITE}/tools/${slug}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        "@id": `${url}#app`,
        name,
        url,
        description: desc,
        applicationCategory: "BusinessApplication",
        operatingSystem: "웹 브라우저",
        inLanguage: "ko-KR",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "KRW" },
        publisher: { "@type": "Organization", name: "오너뷰", url: SITE },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "오너뷰", item: `${SITE}/` },
          { "@type": "ListItem", position: 2, name: "무료 계산기", item: `${SITE}/tools` },
          { "@type": "ListItem", position: 3, name, item: url },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };
}
