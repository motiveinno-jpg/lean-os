// 페이지 체류 계측 — 어느 화면에서 몇 초 머물다, 어디까지 내려 보고, 어디로 갔는지(또는 떠났는지).
//   PageViewBeacon 이 방문 한 건을 적을 때 view_key 를 만들고 startEngagement 로 여기에 맡긴다.
//   · 시간: 화면이 보이던 동안만 센다(다른 탭·최소화 시간 제외).
//   · 스크롤: 창 스크롤과 안쪽 스크롤 상자(앱은 본문 상자가 스크롤된다) 중 가장 많이 내려간 비율.
//   · 끝: 사이트 안 다른 화면으로 가면 navigate(+다음 경로), 탭을 닫거나 숨기면 leave.
//     숨겼다 돌아오면 이어서 세고 다시 보낸다 — 서버(page_view_end)가 큰 값·마지막 방식을 남긴다.
//   전송은 fetch keepalive(페이지가 닫히는 중에도 나간다). 실패는 조용히 버린다.

type Current = { viewKey: string; visitorKey: string; path: string; accMs: number; visibleSince: number | null; maxScroll: number };
//   상태는 window 에 하나만 둔다 — 이 모듈이 화면에 두 벌 실려(번들 중복) 각자 cur 를 들고 있었고,
//   방문을 시작한 쪽과 화면 이동을 받은 쪽이 달라 첫 화면이 마감되지 않았다(2026-09-28 점검 로그로 확인).
type Store = { cur: Current | null; wired: boolean };
function store(): Store {
  const w = window as unknown as { __ovPageEngagement?: Store };
  return (w.__ovPageEngagement ||= { cur: null, wired: false });
}

function scrollPctOf(el: Element | null): number {
  if (!el) {
    const doc = document.documentElement;
    const h = Math.max(doc.scrollHeight, document.body?.scrollHeight || 0);
    if (h <= window.innerHeight + 4) return 100;   // 스크롤할 게 없으면 다 본 것
    return Math.min(100, Math.round(((window.scrollY + window.innerHeight) / h) * 100));
  }
  const e = el as HTMLElement;
  if (e.scrollHeight <= e.clientHeight + 4) return 0;   // 안쪽 상자가 스크롤 대상이 아니면 무시
  return Math.min(100, Math.round(((e.scrollTop + e.clientHeight) / e.scrollHeight) * 100));
}

function onScroll(ev: Event) {
  const cur = store().cur;
  if (!cur) return;
  const t = ev.target;
  const pct = t === document || t === window ? scrollPctOf(null) : scrollPctOf(t as Element);
  if (pct > cur.maxScroll) cur.maxScroll = pct;
}

function elapsed(c: Current): number {
  return c.accMs + (c.visibleSince != null ? Date.now() - c.visibleSince : 0);
}

function send(c: Current, exitKind: "navigate" | "leave", nextPath: string | null) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;
    void fetch(`${url}/rest/v1/rpc/page_view_end`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        p_view_key: c.viewKey, p_visitor_key: c.visitorKey,
        p_duration_ms: Math.round(elapsed(c)), p_max_scroll_pct: c.maxScroll,
        p_exit_kind: exitKind, p_next_path: nextPath,
      }),
    }).catch(() => {});
  } catch { /* 계측 실패는 무해 */ }
}

function onVisibility() {
  const cur = store().cur;
  if (!cur) return;
  if (document.visibilityState === "hidden") {
    if (cur.visibleSince != null) { cur.accMs += Date.now() - cur.visibleSince; cur.visibleSince = null; }
    send(cur, "leave", null);   // 탭을 닫으면 여기서 끝, 돌아오면 이어서 센다
  } else if (cur.visibleSince == null) {
    cur.visibleSince = Date.now();
  }
}

function wire() {
  if (typeof window === "undefined") return;
  const st = store();
  if (st.wired) return;
  st.wired = true;
  window.addEventListener("scroll", onScroll, { passive: true, capture: true });
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", () => { const cur = store().cur; if (cur) { onVisibility(); send(cur, "leave", null); } });
}

/** 직전 화면을 '다른 화면으로 이동'으로 마감한다. 새 화면 경로를 넘긴다.
 *  같은 화면이면 아무것도 안 한다 — 비콘 효과가 한 화면에서 두 번 돌면서, 막 시작한 방문을
 *  '같은 화면으로 이동'으로 곧바로 마감해 체류가 0.1초·스크롤 0%로 남았다(2026-09-28 실측). */
export function endEngagement(nextPath: string) {
  if (typeof window === "undefined") return;
  const st = store();
  if (!st.cur || st.cur.path === nextPath) return;
  if (st.cur.visibleSince != null) { st.cur.accMs += Date.now() - st.cur.visibleSince; st.cur.visibleSince = null; }
  send(st.cur, "navigate", nextPath);
  st.cur = null;
}

/** 방금 적은 방문 한 건의 체류를 재기 시작한다. */
export function startEngagement(viewKey: string, visitorKey: string, path: string) {
  wire();
  store().cur = {
    viewKey, visitorKey, path, accMs: 0,
    visibleSince: document.visibilityState === "visible" ? Date.now() : null,
    maxScroll: scrollPctOf(null),   // 첫 화면에 보이는 만큼은 이미 본 것
  };
}
