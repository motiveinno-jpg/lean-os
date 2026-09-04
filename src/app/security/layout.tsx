import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "보안 — 오너뷰",
  description: "오너뷰가 회사 자료와 인증 정보를 어떻게 지키는지, 사실 그대로 적었습니다.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
