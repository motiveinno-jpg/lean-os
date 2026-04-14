import type { Metadata } from "next";

export const metadata: Metadata = { title: "팀 채팅" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
