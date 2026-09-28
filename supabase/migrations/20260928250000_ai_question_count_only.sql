-- AI 대표 참모: 토큰 한도를 없애고 '질문 횟수'만 센다 (2026-09-28 사장님 결정 — 무료 월 5회 · 오너뷰 월 100회)
--
--   전에는 두 한도가 겹쳐 있었다: 요금제 표에 적힌 토큰(무료 10만·오너뷰 50만, owner-copilot 이 검사)과
--   표에 없던 호출 횟수(무료 5·오너뷰 100, _shared/claude.ts 가 검사). 게다가 횟수는 AI 브리핑·사업자등록증
--   읽기 같은 자동 호출까지 세어 고객이 묻지도 않은 질문이 깎였다.
--   → 토큰 한도 제거(monthly_ai_token_limit = null), 횟수는 고객이 직접 한 질문(feature='owner_copilot')만.
--   AI 토큰 충전 상품은 산 사람이 없고 이제 쓸 데가 없어 판매를 닫는다(api/stripe/credits).

update public.subscription_plans set monthly_ai_token_limit = null;

update public.subscription_plans
   set features = replace(features::text, '"AI 대표 참모 월 10만 토큰"', '"AI 대표 참모 질문 월 5회"')::jsonb
 where slug = 'free';
update public.subscription_plans
   set features = replace(features::text, '"AI 대표 참모 월 50만 토큰"', '"AI 대표 참모 질문 월 100회"')::jsonb
 where slug = 'standard';

-- 이번 달(KST) 질문 수 · 한도 — 엣지(owner-copilot)는 p_company 로, 화면은 인자 없이(내 회사)
create or replace function public.ai_question_allowance(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_slug text; v_limit integer; v_used integer;
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
begin
  if auth.uid() is not null and not exists (select 1 from users where auth_id = auth.uid() and company_id = p_company) then
    return null;
  end if;
  select effective_plan_slug into v_slug from get_company_entitlement(p_company);
  select monthly_ai_call_limit into v_limit from subscription_plans where slug = coalesce(v_slug, 'free');
  select count(*) into v_used from ai_usage_log
   where company_id = p_company and feature = 'owner_copilot' and status = 'ok' and created_at >= v_month_start;
  return jsonb_build_object(
    'plan', coalesce(v_slug, 'free'),
    'limit', v_limit,
    'used', v_used,
    'remaining', case when v_limit is null then null else greatest(0, v_limit - v_used) end,
    'allowed', v_limit is null or v_used < v_limit,
    'resets_at', (v_month_start at time zone 'Asia/Seoul' + interval '1 month') at time zone 'Asia/Seoul'
  );
end;
$function$;
revoke all on function public.ai_question_allowance(uuid) from public, anon;
grant execute on function public.ai_question_allowance(uuid) to authenticated, service_role;

create or replace function public.ai_question_usage()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$ select public.ai_question_allowance(public.get_my_company_id()) $$;
revoke all on function public.ai_question_usage() from public, anon;
grant execute on function public.ai_question_usage() to authenticated;

-- (같은 날 보강) 화면 표시용 요금제 이름·기준 시각을 함께 돌려준다
create or replace function public.ai_question_allowance(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_slug text; v_limit integer; v_used integer; v_name text;
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
begin
  if auth.uid() is not null and not exists (select 1 from users where auth_id = auth.uid() and company_id = p_company) then
    return null;
  end if;
  select effective_plan_slug into v_slug from get_company_entitlement(p_company);
  select monthly_ai_call_limit, name into v_limit, v_name from subscription_plans where slug = coalesce(v_slug, 'free');
  select count(*) into v_used from ai_usage_log
   where company_id = p_company and feature = 'owner_copilot' and status = 'ok' and created_at >= v_month_start;
  return jsonb_build_object(
    'plan', coalesce(v_slug, 'free'),
    'plan_name', v_name,
    'limit', v_limit,
    'used', v_used,
    'remaining', case when v_limit is null then null else greatest(0, v_limit - v_used) end,
    'allowed', v_limit is null or v_used < v_limit,
    'resets_at', (v_month_start at time zone 'Asia/Seoul' + interval '1 month') at time zone 'Asia/Seoul',
    'as_of', now()
  );
end;
$function$;
