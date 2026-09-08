// robots.txt — 네이버 서치어드바이저 "robots.txt 존재하지 않음" 경고 대응 (2026-07-02)
//   공개 페이지는 수집 허용, 로그인 필요 앱 내부·플랫폼 운영자 경로는 크롤링 제외.
import type { MetadataRoute } from "next";

const PRIVATE_PATHS = ["/dashboard", "/platform/", "/api/", "/auth/reset", "/invite", "/sign", "/share", "/company-setup", "/join-pending"];

// AI 검색 크롤러 명시 허용 (2026-09-08 GEO 정비) — ChatGPT·Claude·Perplexity·Gemini 답변에
// 오너뷰가 인용·추천되려면 이 봇들의 수집이 필요하다. `*` 허용만으로도 동작하지만,
// 전용 그룹을 두면 이후 규칙 변경 때 실수로 차단되는 것을 막고 의도를 문서화한다.
const AI_CRAWLERS = [
  "GPTBot", "OAI-SearchBot", "ChatGPT-User",
  "ClaudeBot", "Claude-User", "Claude-SearchBot", "anthropic-ai",
  "PerplexityBot", "Perplexity-User",
  "Google-Extended", "Applebot-Extended", "meta-externalagent", "cohere-ai",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: PRIVATE_PATHS,
      },
      ...AI_CRAWLERS.map((bot) => ({
        userAgent: bot,
        allow: "/" as const,
        disallow: PRIVATE_PATHS,
      })),
    ],
    sitemap: "https://www.owner-view.com/sitemap.xml",
    host: "https://www.owner-view.com",
  };
}
