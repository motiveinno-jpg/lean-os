import type { Metadata } from "next";

export const metadata: Metadata = { title: "결제관리" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
