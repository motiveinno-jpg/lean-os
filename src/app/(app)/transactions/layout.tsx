import type { Metadata } from "next";

export const metadata: Metadata = { title: "거래내역" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
