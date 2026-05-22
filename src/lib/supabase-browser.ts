import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';

export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
