import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "LeanOS — 회사 운영에 필요한 모든 SaaS, 하나로",
  description: "회계/급여/계약/채팅/프로젝트 — 리멤버+모두사인+플렉스+먼데이+AI를 하나의 OS로",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
