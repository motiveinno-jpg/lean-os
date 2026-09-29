// 방문 기록 공통 판별 — 방문(page_views, PageViewBeacon)과 마케팅 이벤트(marketing_events, lib/analytics)가
//   같은 기준으로 '사람이 아닌 방문'과 '우리 팀 방문'을 가르게 한 곳에 둔다 (2026-09-29).
//   전에는 방문 쪽만 걸러 대시보드 방문자와 마케팅 지표 방문 숫자가 크게 달랐다.

/** 자동화·봇(테스트 브라우저·크롤러·미리 렌더) — 기록하지 않는다 */
export function isAutomatedBrowser(): boolean {
  try {
    if ((navigator as unknown as { webdriver?: boolean }).webdriver) return true;
    const ua = navigator.userAgent || "";
    if (/bot|crawler|spider|headless|lighthouse|prerender|scanner|monitor|pingdom|uptime/i.test(ua)) return true;
    if ((document as unknown as { prerendering?: boolean }).prerendering) return true;
  } catch { /* 판별 실패 시 사람으로 취급 */ }
  return false;
}

/** 우리 팀 브라우저 표식(PageViewBeacon 이 내부 회사 로그인·?internal=1 때 붙인다) — 기록은 하되 집계에서 뺀다 */
export function isInternalBrowser(): boolean {
  try { return localStorage.getItem("ownerview_internal") === "1"; } catch { return false; }
}
