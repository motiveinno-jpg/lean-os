// robots.txt — 네이버 서치어드바이저 "robots.txt 존재하지 않음" 경고 대응 (2026-07-02)
//   공개 페이지는 수집 허용, 로그인 필요 앱 내부·플랫폼 운영자 경로는 크롤링 제외.
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard", "/platform/", "/api/", "/auth/reset", "/invite", "/sign", "/share", "/company-setup", "/join-pending"],
      },
    ],
    sitemap: "https://www.owner-view.com/sitemap.xml",
    host: "https://www.owner-view.com",
  };
}
