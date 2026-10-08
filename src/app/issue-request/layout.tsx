import type { Metadata } from "next";

// 세금계산서 발행 요청 — 거래처(공급자)가 메일 링크로 여는 외부 공개 화면.
//   토큰이 주소에 있으므로 검색엔진 색인과 Referer 노출을 막는다(/quote 와 같은 이유).
export const metadata: Metadata = {
  title: "세금계산서 발행 요청",
  description: "거래처가 미리 채운 세금계산서를 확인하고 발행합니다",
  referrer: "no-referrer",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

export default function IssueRequestLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
