// sitemap.xml — 검색엔진 수집용 (2026-07-03)
//   공개 페이지만 노출: 랜딩·데모·약관·개인정보·환불·상태. 로그인 필요 앱 내부는 robots.txt 에서 이미 제외.
import type { MetadataRoute } from "next";

const BASE = "https://www.owner-view.com";
// 무료 계산기 최종 정비일 — 사이트맵 신선도(lastModified) 신호. 계산기 내용/요율 갱신 시 함께 올린다.
const TOOLS_LASTMOD = "2026-08-31";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`, changeFrequency: "weekly", priority: 1 },
    // 랜딩에서 분리된 공개 페이지들 — 사이트맵 누락으로 색인이 안 되고 있었다 (2026-08-13 SEO 정비)
    { url: `${BASE}/pricing`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE}/features`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE}/ai`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/demo`, changeFrequency: "monthly", priority: 0.8 },
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
    { url: `${BASE}/auth`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${BASE}/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/refund`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/status`, changeFrequency: "weekly", priority: 0.2 },
  ];
}
