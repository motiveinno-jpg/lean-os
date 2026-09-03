-- ai_usage_summary: 충전 토큰(credit_balances.ai_tokens)을 잔여량에 합산 (2026-09-03)
--   버그: 월 제공량을 다 쓴 뒤 토큰을 충전한 회사도 AI 참모 화면에 "이번 달 AI 사용량을 모두 사용했습니다"
--   배너가 뜨고 입력이 잠겼다(remaining_tokens 가 제공량-사용량만 계산). 엣지 함수(ai_token_allowance)는
--   충전분을 합쳐 허용하고 있어 서버·화면 판정이 어긋나 있었다.
create or replace function public.ai_usage_summary()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_company uuid;
  v_slug text;
  v_name text;
  v_limit bigint;
  v_used bigint;
  v_credits bigint;
  v_plan_left bigint;
  v_reset timestamptz;
begin
  select company_id into v_company from public.users where auth_id = auth.uid();
  if v_company is null then
    return jsonb_build_object('error', 'no_company');
  end if;

  select effective_plan_slug into v_slug from public.get_company_entitlement(v_company);
  v_slug := coalesce(v_slug, 'free');

  select name, monthly_ai_token_limit into v_name, v_limit
    from public.subscription_plans where slug = v_slug;

  v_used := coalesce(public.ai_tokens_used_this_month(v_company), 0);
  select coalesce(ai_tokens, 0) into v_credits from public.credit_balances where company_id = v_company;
  v_credits := coalesce(v_credits, 0);
  v_plan_left := case when v_limit is null then 0 else greatest(0, v_limit - v_used) end;
  v_reset := (date_trunc('month', (now() at time zone 'Asia/Seoul')) + interval '1 month') at time zone 'Asia/Seoul';

  return jsonb_build_object(
    'plan_slug', v_slug,
    'plan_name', v_name,
    'monthly_limit', v_limit,
    'used_tokens', v_used,
    'plan_remaining', v_plan_left,
    'credit_tokens', v_credits,
    -- 화면의 "남음"·잠금 판정 기준: 제공량 잔여 + 충전 잔액 (엣지 ai_token_allowance 와 동일 기준)
    'remaining_tokens', v_plan_left + v_credits,
    'usage_percent', case when v_limit is null or v_limit = 0 then null
                          else round((v_used::numeric / v_limit) * 100, 1) end,
    'reset_at', v_reset,
    'as_of', now()
  );
end;
$function$;
