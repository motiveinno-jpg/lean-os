// 2026-05-27 v4 — 캐싱 전면 중단 + 기존 캐시 삭제 + SW 교체 시 열린 탭 자동 새로고침.
//   배경: v3(캐싱 중단)을 배포했으나 SW 교체는 "2회 로드"가 필요해 사용자가 1회 새로고침 시
//   여전히 옛 SW 가 stale 화면 서빙 → "그대로" 반복. 오너뷰는 네트워크 기반 앱이라 오프라인
//   캐시보다 항상-최신 정합성 우선.
//   조치: precache 제거, fetch no-op(브라우저 기본 네트워크=항상 최신 해시 자산),
//   activate 에서 모든 캐시 삭제 + claim + 열린 window 자동 navigate(=강제 새로고침, SW 버전당 1회).
//   → 사용자가 사이트를 한 번만 열면, 새 SW 가 활성화되며 탭을 최신으로 자동 재로드.
const SW_VERSION = "v46";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 1) 옛 캐시 전부 제거
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      // 2) 현재 페이지들 제어권 확보
      await self.clients.claim();
      // 3) 열린 탭을 최신으로 강제 새로고침 (activate 는 SW 버전당 1회만 → 새로고침 루프 없음)
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        try { client.navigate(client.url); } catch { /* noop */ }
      }
    })()
  );
});

// fetch 가로채지 않음 → 브라우저 기본 네트워크 경로(항상 최신). SW 가 stale 자산을 절대 서빙하지 않음.
self.addEventListener("fetch", () => {
  // no-op
});

// ── 웹 푸시 (백그라운드 알림) — 2026-07-09 ──
//   탭이 닫혀 있어도 서버(send-web-push 엣지)가 보낸 푸시를 받아 알림 표시.
//   기존 캐시/새로고침 로직과 독립(추가만) — 실패해도 앱 로딩엔 영향 없음.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { body: event.data ? event.data.text() : "" }; }
  const title = data.title || "OwnerView 알림";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || undefined,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      // 이미 열린 탭이 있으면 그 탭을 해당 화면으로 이동 + 포커스
      if ("focus" in c) { try { c.navigate(url); } catch (e) { /* noop */ } return c.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
