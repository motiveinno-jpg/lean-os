import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#6366f1",
};

export const metadata: Metadata = {
  title: {
    template: "%s | 오너뷰",
    default: "OwnerView — 회사 운영 현황을 자동으로 정리해 한눈에 보여줍니다",
  },
  description: "매출·계약·자금·업무 — 대표를 위한 회사 상황판 OS",
  // 네이버 서치어드바이저 사이트 소유 확인 (2026-07-02) — <head>에 naver-site-verification 메타로 출력됨
  verification: {
    other: { "naver-site-verification": "0c0505a824733a39ca296b4420be819eeb2abde8" },
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "오너뷰",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="antialiased" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
