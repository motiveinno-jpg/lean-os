"use client";

// GA4 계측 (2026-08-13 사장님: 마케팅 자동화 1단계 — 측정부터).
//   NEXT_PUBLIC_GA_ID(G-XXXXXXXXXX)가 있을 때만 로드 — 없으면 아무것도 안 한다(로컬·프리뷰 무해).
//   SPA 라우팅은 gtag 기본 page_view 가 못 잡아서 pathname 변화마다 수동 전송.
//   커스텀 이벤트는 lib/analytics.ts 의 track() 사용.

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

export function Analytics() {
  const pathname = usePathname();

  useEffect(() => {
    if (!GA_ID || typeof window === "undefined" || !(window as any).gtag) return;
    (window as any).gtag("event", "page_view", { page_path: pathname });
  }, [pathname]);

  if (!GA_ID) return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}', { send_page_view: false });`}
      </Script>
    </>
  );
}
