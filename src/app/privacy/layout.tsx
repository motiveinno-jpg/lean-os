import type { Metadata } from "next";

export const metadata: Metadata = { title: "개인정보처리방침" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
