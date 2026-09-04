import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';

// ── DB 오류 전수 수집 인터셉터 (2026-07-28 사장님: "디비에서 발생하는 모든 오류를 로그로") ──
//   Supabase 로 나가는 모든 요청의 오류 응답(4xx/5xx)을 한 지점에서 error_logs 에 적재.
//   개별 화면에 심을 필요 없이, 앞으로 만드는 기능까지 자동 커버.
//   규칙: /rest/v1/error_logs 요청은 스킵(재귀 방지) · /auth/v1 은 5xx만(비번 오타·토큰 만료 소음 제외)
//        · 요청 본문은 기록 안 함(민감정보) — 경로·상태·서버 오류 메시지만.
//   적재 자체는 error-logger 의 5초 동일서명 dedupe 를 그대로 사용, 실패해도 원 요청에 영향 없음.
// ── 저장 실패 화면 반응 (2026-09-03 사장님: "오류가 나더라도 반응할 수 있게") ──
//   결과를 확인하지 않는 `await db.from(...).update(...)` 가 207곳 — 실패해도 화면은 조용했다.
//   여기서 쓰기 요청(POST/PATCH/PUT/DELETE)의 오류 응답을 한 번에 잡아 앱 셸 배너 이벤트를 띄운다.
//   호출부가 이미 오류 토스트를 띄웠으면(toast.tsx 가 __ovErrorToastAt 표시) 겹치지 않게 건너뛴다.
//   읽기성 RPC(is_/get_/list_/platform_ …)와 인증·자기 로그 요청은 제외.
const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const READ_RPC = /^\/rest\/v1\/rpc\/(is_|has_|get_|list_|find_|search_|count_|platform_|feature_on|daily_|reconcile_|can_|check_)/;
function isWriteFailure(path: string, method: string, status: number): boolean {
  if (!WRITE_METHODS.has(method)) return false;
  if (path.startsWith('/rest/v1/')) return !READ_RPC.test(path);
  if (path.startsWith('/storage/v1/object')) return true;
  if (path.startsWith('/functions/v1/')) return status >= 500;
  return false;
}
function notifyWriteFailure(status: number, detail: string) {
  setTimeout(() => {
    try {
      const w = window as unknown as { __ovErrorToastAt?: number };
      if (w.__ovErrorToastAt && Date.now() - w.__ovErrorToastAt < 2000) return; // 호출부가 직접 안내함
      import('./friendly-error').then(({ friendlyError }) => {
        const msg = friendlyError({ code: (() => { try { const j = JSON.parse(detail); return j.code; } catch { return undefined; } })(), message: detail, status }, '저장 중 오류가 발생했습니다. 다시 시도해주세요.');
        window.dispatchEvent(new CustomEvent('ownerview:db-write-error', { detail: msg }));
      }).catch(() => {});
    } catch { /* 반응 실패가 원 요청을 방해하지 않는다 */ }
  }, 350);
}

function interceptedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, init).then((res) => {
    try {
      if (res.status >= 400 && typeof window !== 'undefined') {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const path = (() => { try { return new URL(url).pathname; } catch { return String(url).slice(0, 200); } })();
        const method = String(init?.method || 'GET').toUpperCase();
        const isSelfLog = path.includes('/error_logs');
        const isAuthNoise = path.startsWith('/auth/v1') && res.status < 500;
        // 서버 기능(functions)의 4xx 는 "PDF만 올릴 수 있어요" 같은 사용자 안내라 오류가 아니다 — 5xx 만 기록.
        //   (5xx 는 서버 쪽 래퍼가 함수 이름·본문과 함께 따로 남기고, 여기선 "누가·어느 화면"을 보탠다.) 2026-09-03
        const isFunctionGuidance = path.startsWith('/functions/v1/') && res.status < 500;
        if (!isSelfLog && !isAuthNoise && !isFunctionGuidance) {
          res.clone().text().then((body) => {
            let detail = body.slice(0, 400);
            try { const j = JSON.parse(body); detail = j.message || j.error || j.msg || detail; } catch { /* 원문 유지 */ }
            // 세션 만료·기기 시계 오차(JWT expired / issued at future)로 난 401 은 재로그인으로 풀리는 상태라 기록장에 안 쌓는다.
            if (res.status === 401 && /jwt|token/i.test(detail)) {
              // 사용자는 조용히 빈 화면만 보게 되므로 다시 로그인하라고 알린다. 시계 오차는 원인을 같이 적는다.
              window.dispatchEvent(new CustomEvent('ownerview:session-expired', { detail: /future/i.test(detail) ? 'clock' : 'expired' }));
              return;
            }
            if (isWriteFailure(path, method, res.status)) notifyWriteFailure(res.status, body.slice(0, 400) || detail);
            import('./error-logger').then(({ logError }) => {
              logError({
                source: 'manual',
                message: `[DB ${res.status}] ${method} ${path} — ${detail}`,
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
