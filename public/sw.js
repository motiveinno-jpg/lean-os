// 2026-05-27 v3 — 캐싱 전면 중단 + 기존 캐시 전부 삭제.
//   배경: 디자인 변경(인디고/글래스/아이콘타일/여백)을 여러 번 배포했으나 사용자 화면이 계속
//   stale("그대로") — SW 가 옛 자산/HTML 을 잡고 있던 게 주원인으로 판단. 오너뷰는 네트워크
//   기반(Supabase) 앱이라 오프라인 precache 의 가치보다 정합성(항상 최신)이 우선.
//   조치: precache 제거, fetch 가로채기 제거(브라우저 기본 네트워크 처리 = 항상 최신 + 해시 자산),
//   activate 에서 모든 캐시 삭제 + claim. SW 는 등록 상태만 유지(PWA 설치 가능).
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k))); // 옛 캐시 전부 제거
      await self.clients.claim();
    })()
  );
});

// fetch 핸들러에서 respondWith 호출하지 않음 → 브라우저 기본 네트워크 경로(항상 최신).
// (핸들러 자체를 두지 않으면 패스스루. 명시적으로 비워 의도를 분명히 함.)
self.addEventListener("fetch", () => {
  // no-op: 네트워크 그대로. SW 가 stale 자산을 절대 서빙하지 않음.
});
