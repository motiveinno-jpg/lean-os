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
//
// 집계 보정 (2026-08-25 사장님 지적 "다 우리가 테스트한 것 아니냐" — 실제로 그랬다):
//   - 내부(우리 팀) 방문은 is_internal 로 표시해 외부 방문자 수에서 뺀다.
//     visitor_key 가 localStorage 난수라 시크릿 창을 열 때마다 '새 방문자'가 되던 문제.
//   - 같은 경로가 60초 안에 두 번 적히는 것을 막는다. 네이버 유입이 1초 뒤 referrer 없이
//     한 번 더 적혀 뷰가 2배로 부풀던 문제(referrerHost() 가 자기 도메인을 지우기 때문).

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";

// page_views 는 생성된 DB 타입에 아직 없다(신규 테이블). 저장소 관례대로 any 캐스트.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const VISITOR_KEY = "ownerview_visitor_key";
// 이 브라우저가 내부(우리 팀) 것이라는 표식. 한 번 붙으면 로그아웃 상태로 돌아다녀도 유지된다
//   — 우리 팀은 로그인 없이 랜딩·계산기를 열어보는 일이 잦고, 그게 바로 외부 방문자로 새던 경로다.
const INTERNAL_KEY = "ownerview_internal";
// 회사의 내부 여부 조회 결과 캐시(탭 단위) — 페이지마다 companies 를 다시 읽지 않으려고 둔다.
const INTERNAL_CACHE_KEY = "ownerview_internal_company";
// 같은 경로 재기록 차단용 — sessionStorage 라 탭 안에서는 전체 페이지 이동에도 살아남는다.
const DEDUP_PREFIX = "ownerview_pv:";
const DEDUP_WINDOW_MS = 60_000;

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

/** 이 브라우저에 붙은 내부 표식. `?internal=1` 로 직접 붙이고 `?internal=0` 으로 뗀다.
 *  시크릿 창 테스트는 로그인도 표식도 없어 여전히 외부로 잡힌다 — 그건 막을 방법이 없으므로
 *  화면에서 '검색 유입'(우리가 만들 수 없는 기록) 을 따로 보여주는 것으로 보완한다. */
function internalFlag(): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get("internal");
    if (q === "1") localStorage.setItem(INTERNAL_KEY, "1");
    if (q === "0") localStorage.removeItem(INTERNAL_KEY);
    return localStorage.getItem(INTERNAL_KEY) === "1";
  } catch {
    return false;
  }
}

function markInternal() {
  try { localStorage.setItem(INTERNAL_KEY, "1"); } catch { /* 스토리지 차단 — 무시 */ }
}

/** 같은 경로를 60초 안에 다시 적으려 하면 막는다. 막았으면 true. */
function seenRecently(path: string): boolean {
  try {
    const k = DEDUP_PREFIX + path;
    const prev = Number(sessionStorage.getItem(k) || 0);
    const now = Date.now();
    if (prev && now - prev < DEDUP_WINDOW_MS) return true;
    sessionStorage.setItem(k, String(now));
    return false;
  } catch {
    return false; // 스토리지 차단 시엔 그냥 보낸다(조회 쪽에서 한 번 더 접는다)
  }
}

/** 로그인한 사용자의 회사가 우리 소유(companies.is_internal)인지. 탭 단위로 캐시한다. */
async function companyIsInternal(companyId: string): Promise<boolean> {
  try {
    const cached = sessionStorage.getItem(INTERNAL_CACHE_KEY);
    if (cached) {
      const [id, val] = cached.split(":");
      if (id === companyId) return val === "1";
    }
  } catch { /* 캐시 못 읽으면 그냥 조회한다 */ }
  try {
    const { data } = await db.from("companies").select("is_internal").eq("id", companyId).maybeSingle();
    const val = !!(data as { is_internal?: boolean } | null)?.is_internal;
    try { sessionStorage.setItem(INTERNAL_CACHE_KEY, `${companyId}:${val ? "1" : "0"}`); } catch { /* 무시 */ }
    return val;
  } catch {
    return false; // 조회 실패는 외부로 취급 — 집계를 임의로 지우지 않는다
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

    const path = pathname.split("?")[0].slice(0, 300);
    if (seenRecently(path)) return;

    let cancelled = false;
    (async () => {
      try {
        // 로그인 여부만 본다(누구인지는 안 보냄). company_id 는 있으면 참고용으로만.
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled) return;
        let companyId: string | null = null;
        let internal = internalFlag();
        if (session?.user) {
          const { data } = await supabase
            .from("users").select("company_id").eq("auth_id", session.user.id).maybeSingle();
          companyId = (data as { company_id?: string } | null)?.company_id ?? null;
          if (!internal && companyId && (await companyIsInternal(companyId))) {
            internal = true;
            markInternal(); // 이후 로그아웃 상태 방문까지 내부로 이어지게 표식을 남긴다
          }
        }
        if (cancelled) return;
        await db.from("page_views").insert({
          path,
          visitor_key: visitorKey,
          is_auth: !!session?.user,
          referrer_host: referrerHost(),
          company_id: companyId,
          is_internal: internal,
        });
      } catch {
        /* 수집 실패는 무시 — 사용자 경험에 영향 없음 */
      }
    })();

    return () => { cancelled = true; };
  }, [pathname]);

  return null;
}
