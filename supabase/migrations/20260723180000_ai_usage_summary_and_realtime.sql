-- AI 참모 재설계 — 실시간 토큰 대시보드 백엔드 기반 (2026-07-23).
--   ① Pro(basic) 월 토큰 한도 확정(추천 50만) ② ai_usage_summary() RPC(IDOR 안전) ③ ai_usage_log Realtime.

-- ① Pro 토큰 한도 (추천 초안 500,000/월 — 정책 조정 가능). NULL=미허용(잠금). '무제한' 아님.
update public.subscription_plans set monthly_ai_token_limit = 500000 where slug = 'basic';

-- ② 현재 로그인 사용자 회사의 AI 토큰 사용 요약 (파라미터 없음 → company_id 는 auth 에서 서버 결정, IDOR 불가).
create or replace function public.ai_usage_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  v_slug text;
  v_name text;
  v_limit bigint;
  v_used bigint;
  v_reset timestamptz;
begin
  select company_id into v_company from public.users where auth_id = auth.uid();
  if v_company is null then
    return jsonb_build_object('error', 'no_company');
  end if;

  -- 실효 플랜(entitlement) — 만료/해지 시 free. get_company_entitlement 는 자기 회사만(호출자=회사 일치).
  select effective_plan_slug into v_slug from public.get_company_entitlement(v_company);
  v_slug := coalesce(v_slug, 'free');

  select name, monthly_ai_token_limit into v_name, v_limit
    from public.subscription_plans where slug = v_slug;

  v_used := public.ai_tokens_used_this_month(v_company);
  -- 다음 초기화 = 다음달 1일 0시(KST)
  v_reset := (date_trunc('month', (now() at time zone 'Asia/Seoul')) + interval '1 month') at time zone 'Asia/Seoul';

  return jsonb_build_object(
    'plan_slug', v_slug,
    'plan_name', v_name,
    'monthly_limit', v_limit,   -- NULL 가능 = 미허용(잠금). 클라는 무제한으로 해석 금지.
    'used_tokens', coalesce(v_used, 0),
    'remaining_tokens', case when v_limit is null then 0 else greatest(0, v_limit - coalesce(v_used,0)) end,
    'usage_percent', case when v_limit is null or v_limit = 0 then null
                          else round((coalesce(v_used,0)::numeric / v_limit) * 100, 1) end,
    'reset_at', v_reset,
    'as_of', now()
  );
end;
$$;
revoke execute on function public.ai_usage_summary() from anon;
grant execute on function public.ai_usage_summary() to authenticated;

-- ③ ai_usage_log Realtime — RLS(회사 구성원만 select)가 구독 이벤트에도 적용되어 타 회사 이벤트 미수신.
alter publication supabase_realtime add table public.ai_usage_log;
