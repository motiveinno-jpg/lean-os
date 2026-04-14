import type { Metadata } from "next";

export const metadata: Metadata = { title: "데이터 가져오기" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
