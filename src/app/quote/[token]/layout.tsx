import type { Metadata } from "next";

// STEP 4 (PR-A) — 외부 비로그인 견적 승인 페이지 segment metadata.
//   security-reviewer I1 요구사항: referrer 0 노출.
//   Next 16 / React 19 — segment metadata.referrer 가 page <head> 에
//   <meta name="referrer" content="no-referrer"> 를 자동 출력.
//   토큰이 URL path 에 있어도 외부 자원 요청(이미지/스크립트/CSS) 시 Referer 헤더가
//   따라가지 않도록 강제.
//
// 추가: robots noindex — 토큰 URL 이 검색엔진에 노출되지 않도록.

export const metadata: Metadata = {
  title: "견적서 확인",
  description: "발송자가 공유한 견적서를 확인하고 승인/거절을 결정합니다",
  referrer: "no-referrer",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

export default function QuoteTokenLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
