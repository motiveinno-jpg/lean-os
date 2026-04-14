import type { Metadata } from "next";

export const metadata: Metadata = { title: "온보딩" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
