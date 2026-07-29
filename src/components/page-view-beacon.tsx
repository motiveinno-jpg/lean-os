"use client";

// 방문자·페이지뷰 수집 비콘 (2026-07-28 사장님 요청 — 운영자 대시보드 트래픽).
//
// 개인정보 최소 수집:
//   - IP·User-Agent 원문을 보내지 않는다. 서버도 저장하지 않는다.
//   - 방문자 구분은 브라우저가 만든 난수 visitor_key 하나뿐 — 개인 식별 불가.
//   - referrer 는 호스트만 남긴다(전체 URL·쿼리스트링은 검색어·토큰이 섞일 수 있어 버린다).
//   - 경로도 쿼리스트링을 떼고 보낸다. 서명 링크 토큰(/sign/xxx) 같은 건 경로 자체가
//     비밀이라 아래 SKIP_PREFIXES 로 아예 수집하지 않는다.
//
// 실패해도 화면에 영향 없음 — 수집은 부가 기능이라 전부 조용히 삼킨다.

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";

// page_views 는 생성된 DB 타입에 아직 없다(신규 테이블). 저장소 관례대로 any 캐스트.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const VISITOR_KEY = "ownerview_visitor_key";

// 경로 자체가 비밀이거나(서명·공유 토큰) 수집 의미가 없는 곳.
//   /platform = 운영자 콘솔 — 운영자가 콘솔을 돌아다니는 건 고객 트래픽이 아니다(2026-07-29 사장님).
const SKIP_PREFIXES = ["/sign/", "/share/", "/api/", "/_next", "/platform"];

// 자동화·봇 제외 (2026-07-29 사장님: "실제 사람이 화면을 본 것만 카운팅").
//   - navigator.webdriver: Playwright·Selenium·agent-browser 등 자동화 브라우저가 전부 true
//   - UA 의 봇 시그니처: 헤드리스 크롬·크롤러·라이트하우스 등 (UA 는 판별에만 쓰고 저장 안 함)
//   - document.prerendering: 크롬이 미리 렌더만 해둔 화면 — 사람이 본 게 아님
function isAutomated(): boolean {
  try {
    if ((navigator as unknown as { webdriver?: boolean }).webdriver) return true;
    const ua = navigator.userAgent || "";
    if (/bot|crawler|spider|headless|lighthouse|prerender|scanner|monitor|pingdom|uptime/i.test(ua)) return true;
    if ((document as unknown as { prerendering?: boolean }).prerendering) return true;
  } catch { /* 판별 실패 시 사람으로 취급 */ }
  return false;
}

function getVisitorKey(): string | null {
  try {
    let k = localStorage.getItem(VISITOR_KEY);
    if (!k) {
      k = (crypto.randomUUID?.() ?? `v${Date.now()}${Math.random()}`).replace(/-/g, "").slice(0, 24);
      localStorage.setItem(VISITOR_KEY, k);
    }
    return k;
  } catch {
    return null; // 스토리지 차단(시크릿 모드 등) — 수집 생략
  }
}

function referrerHost(): string | null {
  try {
    if (!document.referrer) return null;
    const h = new URL(document.referrer).hostname;
    // 자기 사이트 내부 이동은 유입이 아니다
    return h && h !== window.location.hostname ? h.slice(0, 120) : null;
  } catch {
    return null;
  }
}

export function PageViewBeacon() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    if (SKIP_PREFIXES.some((p) => pathname.startsWith(p))) return;
    if (isAutomated()) return;

    const visitorKey = getVisitorKey();
    if (!visitorKey) return;

    let cancelled = false;
    (async () => {
      try {
        // 로그인 여부만 본다(누구인지는 안 보냄). company_id 는 있으면 참고용으로만.
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled) return;
        let companyId: string | null = null;
        if (session?.user) {
          const { data } = await supabase
            .from("users").select("company_id").eq("auth_id", session.user.id).maybeSingle();
          companyId = (data as { company_id?: string } | null)?.company_id ?? null;
        }
        if (cancelled) return;
        await db.from("page_views").insert({
          path: pathname.split("?")[0].slice(0, 300),
          visitor_key: visitorKey,
          is_auth: !!session?.user,
          referrer_host: referrerHost(),
          company_id: companyId,
        });
      } catch {
        /* 수집 실패는 무시 — 사용자 경험에 영향 없음 */
      }
    })();

    return () => { cancelled = true; };
  }, [pathname]);

  return null;
}
