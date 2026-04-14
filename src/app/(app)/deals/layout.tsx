import type { Metadata } from "next";

export const metadata: Metadata = { title: "프로젝트 관리" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
