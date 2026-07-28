// 서버(API 라우트) 에러 → error_logs 적재 (2026-07-28)
//   배경: error_logs 는 브라우저에서 잡힌 에러만 들어와 서버 실패(웹훅·가입·결제)가
//   운영자 "시스템 상태" 화면에 전혀 안 보였다. 서버 라우트의 실패 지점에서 호출한다.
//   service role 로 적재(RLS 무관), 실패해도 절대 throw 하지 않는다 — 로깅이 본 흐름을 막으면 안 됨.
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

export async function logServerError(params: {
  where: string;                       // 예: 'stripe-webhook', 'join-request'
  message: string;
  companyId?: string | null;
  context?: Record<string, unknown>;
}): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    await admin.from('error_logs').insert({
      company_id: params.companyId ?? null,
      source: 'manual',
      error_type: 'server',
      message: `[${params.where}] ${String(params.message).slice(0, 1800)}`,
      context: (params.context ?? null) as never,
    });
  } catch {
    // 적재 실패는 무시 — console 에는 호출부가 이미 남긴다
  }
}
