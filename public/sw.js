// 2026-05-27 v4 — 캐싱 전면 중단 + 기존 캐시 삭제 + SW 교체 시 열린 탭 자동 새로고침.
//   배경: v3(캐싱 중단)을 배포했으나 SW 교체는 "2회 로드"가 필요해 사용자가 1회 새로고침 시
//   여전히 옛 SW 가 stale 화면 서빙 → "그대로" 반복. 오너뷰는 네트워크 기반 앱이라 오프라인
//   캐시보다 항상-최신 정합성 우선.
//   조치: precache 제거, fetch no-op(브라우저 기본 네트워크=항상 최신 해시 자산),
//   activate 에서 모든 캐시 삭제 + claim + 열린 window 자동 navigate(=강제 새로고침, SW 버전당 1회).
//   → 사용자가 사이트를 한 번만 열면, 새 SW 가 활성화되며 탭을 최신으로 자동 재로드.
const SW_VERSION = "v44";

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
