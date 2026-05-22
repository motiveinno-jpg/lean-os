import type { Metadata } from "next";

// 2026-05-22 파트너 포털 외부(비로그인) 페이지 — quote/[token] 패턴 미러.
//   토큰이 URL path 에 있으므로 referrer 0 노출 + 검색엔진 noindex.
export const metadata: Metadata = {
  title: "파트너 포털 — 서류 확인",
  description: "공유받은 견적·계약 서류를 확인합니다",
  referrer: "no-referrer",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

export default function PartnerPortalLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
