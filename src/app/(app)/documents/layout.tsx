import type { Metadata } from "next";

export const metadata: Metadata = { title: "문서관리" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
