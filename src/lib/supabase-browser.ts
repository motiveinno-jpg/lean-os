import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';

// ── DB 오류 전수 수집 인터셉터 (2026-07-28 사장님: "디비에서 발생하는 모든 오류를 로그로") ──
//   Supabase 로 나가는 모든 요청의 오류 응답(4xx/5xx)을 한 지점에서 error_logs 에 적재.
//   개별 화면에 심을 필요 없이, 앞으로 만드는 기능까지 자동 커버.
//   규칙: /rest/v1/error_logs 요청은 스킵(재귀 방지) · /auth/v1 은 5xx만(비번 오타·토큰 만료 소음 제외)
//        · 요청 본문은 기록 안 함(민감정보) — 경로·상태·서버 오류 메시지만.
//   적재 자체는 error-logger 의 5초 동일서명 dedupe 를 그대로 사용, 실패해도 원 요청에 영향 없음.
function interceptedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, init).then((res) => {
    try {
      if (res.status >= 400 && typeof window !== 'undefined') {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const path = (() => { try { return new URL(url).pathname; } catch { return String(url).slice(0, 200); } })();
        const isSelfLog = path.includes('/error_logs');
        const isAuthNoise = path.startsWith('/auth/v1') && res.status < 500;
        if (!isSelfLog && !isAuthNoise) {
          res.clone().text().then((body) => {
            let detail = body.slice(0, 400);
            try { const j = JSON.parse(body); detail = j.message || j.error || j.msg || detail; } catch { /* 원문 유지 */ }
            import('./error-logger').then(({ logError }) => {
              logError({
                source: 'manual',
                message: `[DB ${res.status}] ${init?.method || 'GET'} ${path} — ${detail}`,
                context: { status: res.status, path, page: window.location.pathname },
              });
            }).catch(() => {});
          }).catch(() => {});
        }
      }
    } catch { /* 로깅이 원 요청을 방해하지 않는다 */ }
    return res;
  });
}

export function createSupabaseBrowserClient() {
  // .trim() — env 값 끝 개행(\n)이 realtime WS URL 에 %0A 로 박혀 인증실패+재연결폭주 유발하던 버그 차단(2026-06-10)
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
    { global: { fetch: interceptedFetch } },
  );
}

// 2026-05-22 lazy 초기화 — 모듈 top-level 에서 즉시 createClient 하면
//   빌드 타임 page-data 수집(서버 route 모듈 평가) 시 env 가 없어 throw → 빌드 전체 실패.
//   첫 접근 시점에만 생성하는 Proxy 로 감싸 빌드 타임 평가에서 client 를 만들지 않음.
//   런타임(브라우저/서버 핸들러)에서는 첫 .from()/.auth 접근 시 정상 생성.
type BrowserClient = ReturnType<typeof createSupabaseBrowserClient>;
let _client: BrowserClient | null = null;
function getClient(): BrowserClient {
  if (!_client) _client = createSupabaseBrowserClient();
  return _client;
}

export const supabase = new Proxy({} as BrowserClient, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
}) as BrowserClient;
