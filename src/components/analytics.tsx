"use client";

// GA4 계측 (2026-08-13 사장님: 마케팅 자동화 1단계 — 측정부터).
//   NEXT_PUBLIC_GA_ID(G-XXXXXXXXXX)가 있을 때만 로드 — 없으면 아무것도 안 한다(로컬·프리뷰 무해).
//   SPA 라우팅은 gtag 기본 page_view 가 못 잡아서 pathname 변화마다 수동 전송.
//   커스텀 이벤트는 lib/analytics.ts 의 track() 사용.

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { track } from "@/lib/analytics";

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

export function Analytics() {
  const pathname = usePathname();

  useEffect(() => {
    // track() 경유 — 종전엔 gtag 를 직접 불러 우리 DB(marketing_events)엔 방문이 한 건도 안 쌓였다.
    //   그래서 운영자 마케팅 퍼널의 맨 위 '방문'이 늘 0 이고 전환율이 전부 무의미했다(2026-08-20).
    //   공개 마케팅 경로만 적재하는 필터는 track() 안에 그대로 있다. GA 미설치·차단이어도 자체 기록은 남는다.
    if (typeof window === "undefined") return;
    track("page_view", { page_path: pathname });
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
