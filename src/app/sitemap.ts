// sitemap.xml — 검색엔진 수집용 (2026-07-03)
//   공개 페이지만 노출: 랜딩·데모·약관·개인정보·환불·상태. 로그인 필요 앱 내부는 robots.txt 에서 이미 제외.
import type { MetadataRoute } from "next";

const BASE = "https://www.owner-view.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/demo`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/auth`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${BASE}/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/refund`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/status`, changeFrequency: "weekly", priority: 0.2 },
  ];
}
