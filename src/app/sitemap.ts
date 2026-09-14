// sitemap.xml — 검색엔진 수집용 (2026-07-03)
//   공개 페이지만 노출: 랜딩·데모·약관·개인정보·환불·상태. 로그인 필요 앱 내부는 robots.txt 에서 이미 제외.
import type { MetadataRoute } from "next";
import { POSTS } from "./blog/posts";

const BASE = "https://www.owner-view.com";
// 무료 계산기 최종 정비일 — 사이트맵 신선도(lastModified) 신호. 계산기 내용/요율 갱신 시 함께 올린다.
const TOOLS_LASTMOD = "2026-08-31";

// 2026-09-14 주소 끝 `/` — next.config 의 trailingSlash: true 라 `/pricing` 은 `/pricing/` 로 308 을 한 번 거친다.
//   페이지 canonical 은 Next 가 `/` 를 붙여 주므로, 사이트맵도 같은 주소를 적어 검색로봇이 리다이렉트를 따라가지 않게 한다.
//   쿼리가 붙은 주소(`/features/?g=`)는 이미 `/` 를 적어 두었다.
const withSlash = (url: string) => (url.includes("?") || url.endsWith("/") ? url : `${url}/`);

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: MetadataRoute.Sitemap = [
    // 2026-09-07 랜딩을 v7 로 갈아 끼웠다 — 다시 수집하도록 lastModified 를 올린다
    // 2026-09-14 v8(9/9) + 상담 신청·관련 검색어 링크(9/14) 반영
    { url: `${BASE}/`, changeFrequency: "weekly", priority: 1, lastModified: "2026-09-14" },
    // 랜딩에서 분리된 공개 페이지들 — 사이트맵 누락으로 색인이 안 되고 있었다 (2026-08-13 SEO 정비)
    { url: `${BASE}/pricing`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE}/features`, changeFrequency: "monthly", priority: 0.9 },
    // 2026-09-14 그룹마다 서버에서 그리고 canonical 을 따로 준다 — 각자 색인될 문서
    ...["finance", "inventory", "analysis", "workspace", "hr"].map((g) => (
      { url: `${BASE}/features/?g=${g}`, changeFrequency: "monthly" as const, priority: 0.8, lastModified: "2026-09-14" }
    )),
    { url: `${BASE}/ai`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/demo`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/contact`, changeFrequency: "yearly", priority: 0.7, lastModified: "2026-09-14" },
    { url: `${BASE}/guide`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/tax-partners`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/advisor`, changeFrequency: "monthly", priority: 0.6 },
    // 무료 도구 — 검색 유입용 공개 계산기 (2026-08-13 사장님 지시, 2026-08-31 허브·신선도 정비)
    { url: `${BASE}/tools`, changeFrequency: "monthly", priority: 0.9, lastModified: TOOLS_LASTMOD },
    { url: `${BASE}/tools/leave-calculator`, changeFrequency: "monthly", priority: 0.9, lastModified: TOOLS_LASTMOD },
    { url: `${BASE}/tools/severance-calculator`, changeFrequency: "monthly", priority: 0.9, lastModified: TOOLS_LASTMOD },
    { url: `${BASE}/tools/insurance-calculator`, changeFrequency: "monthly", priority: 0.9, lastModified: TOOLS_LASTMOD },
    { url: `${BASE}/tools/salary-calculator`, changeFrequency: "monthly", priority: 0.9, lastModified: TOOLS_LASTMOD },
    { url: `${BASE}/tools/weekly-holiday-calculator`, changeFrequency: "monthly", priority: 0.9, lastModified: TOOLS_LASTMOD },
    { url: `${BASE}/tools/vat-calculator`, changeFrequency: "monthly", priority: 0.9, lastModified: TOOLS_LASTMOD },
    // 블로그 — GEO/AI검색 인용용 전문 콘텐츠 허브 (2026-09-08 신설). 글 추가 시 blog/posts.ts 와 함께 갱신.
    { url: `${BASE}/blog`, changeFrequency: "weekly", priority: 0.8, lastModified: "2026-09-08" },
    // 글은 blog/posts.ts 에서 읽는다 — 그 파일 머리주석대로 글을 넣으면 여기도 따라온다 (2026-09-14, 전에는 손으로 적었다)
    ...POSTS.map((p) => ({ url: `${BASE}/blog/${p.slug}`, changeFrequency: "monthly" as const, priority: 0.8, lastModified: p.date })),
    { url: `${BASE}/security`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${BASE}/auth`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${BASE}/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/refund`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/status`, changeFrequency: "weekly", priority: 0.2 },
  ];
  return pages.map((e) => ({ ...e, url: withSlash(e.url) }));
}
