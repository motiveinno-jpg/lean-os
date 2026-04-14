import type { Metadata } from "next";

export const metadata: Metadata = { title: "이용약관" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
