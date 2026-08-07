-- 충전(크레딧) 소비·적립 함수 (2026-08-07) — 운영 적용본과 동일한 정의
--
-- 소비 순서: 월 기본 제공량을 먼저 쓰고, 다 쓰면 충전 잔액에서 차감한다.
-- 무료 플랜은 충전을 구매할 수 없으므로 잔액이 0이고, 결과적으로 기본 제공량까지만 쓴다.

-- ① 발행(세금계산서+현금영수증) 가능 여부 + 남은 양
create or replace function public.issue_allowance(p_company_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $$
declare
  v_slug text; v_limit int; v_used int; v_credits int; v_plan_left int;
begin
  select effective_plan_slug into v_slug from public.get_company_entitlement(p_company_id);
  v_slug := coalesce(v_slug, 'free');
  select monthly_issue_limit into v_limit from public.subscription_plans where slug = v_slug;
  select total_count into v_used from public.get_monthly_issue_usage(p_company_id);
  v_used := coalesce(v_used, 0);
  select coalesce(issue_credits, 0) into v_credits from public.credit_balances where company_id = p_company_id;
  v_credits := coalesce(v_credits, 0);

  -- limit 이 null 이면 무제한 플랜
  if v_limit is null then
    return jsonb_build_object('unlimited', true, 'allowed', true, 'plan_limit', null,
      'used', v_used, 'plan_remaining', null, 'credits', v_credits, 'total_remaining', null);
  end if;

  v_plan_left := greatest(0, v_limit - v_used);
  return jsonb_build_object(
    'unlimited', false,
    'allowed', (v_plan_left + v_credits) > 0,
    'plan_limit', v_limit,
    'used', v_used,
    'plan_remaining', v_plan_left,
    'credits', v_credits,
    'total_remaining', v_plan_left + v_credits
  );
end;
$$;

-- ② 발행 1건 차감 — 월 제공량이 남아 있으면 잔액을 건드리지 않는다(그건 사용 집계로 자동 계산).
--    다 썼을 때만 충전 잔액에서 1건 뺀다. 발행 성공 직후 서버가 호출한다.
create or replace function public.consume_issue_credit(p_company_id uuid)
returns boolean
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
  v jsonb; v_plan_left int; v_unlimited boolean;
begin
  v := public.issue_allowance(p_company_id);
  v_unlimited := coalesce((v->>'unlimited')::boolean, false);
  if v_unlimited then return true; end if;

  v_plan_left := coalesce((v->>'plan_remaining')::int, 0);
  if v_plan_left > 0 then
    return true;  -- 월 제공량으로 커버 — 잔액 손대지 않는다
  end if;

  update public.credit_balances
     set issue_credits = issue_credits - 1, updated_at = now()
   where company_id = p_company_id and issue_credits > 0;
  return found;
end;
$$;

-- ③ AI 토큰 — 월 제공량 + 충전 잔액 합산 관점의 남은 양
create or replace function public.ai_token_allowance(p_company_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $$
declare
  v_slug text; v_limit bigint; v_used bigint; v_credits bigint; v_plan_left bigint;
begin
  select effective_plan_slug into v_slug from public.get_company_entitlement(p_company_id);
  v_slug := coalesce(v_slug, 'free');
  select monthly_ai_token_limit into v_limit from public.subscription_plans where slug = v_slug;
  v_used := coalesce(public.ai_tokens_used_this_month(p_company_id), 0);
  select coalesce(ai_tokens, 0) into v_credits from public.credit_balances where company_id = p_company_id;
  v_credits := coalesce(v_credits, 0);

  if v_limit is null then
    return jsonb_build_object('unlimited', true, 'allowed', true, 'plan_limit', null,
      'used', v_used, 'plan_remaining', null, 'credits', v_credits, 'total_remaining', null);
  end if;

  v_plan_left := greatest(0, v_limit - v_used);
  return jsonb_build_object(
    'unlimited', false,
    'allowed', (v_plan_left + v_credits) > 0,
    'plan_limit', v_limit,
    'used', v_used,
    'plan_remaining', v_plan_left,
    'credits', v_credits,
    'total_remaining', v_plan_left + v_credits
  );
end;
$$;

-- ④ AI 토큰 차감 — 월 제공량을 넘어선 만큼만 잔액에서 뺀다.
create or replace function public.consume_ai_tokens(p_company_id uuid, p_tokens bigint)
returns boolean
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
  v jsonb; v_plan_left bigint; v_over bigint;
begin
  if p_tokens is null or p_tokens <= 0 then return true; end if;
  v := public.ai_token_allowance(p_company_id);
  if coalesce((v->>'unlimited')::boolean, false) then return true; end if;

  v_plan_left := coalesce((v->>'plan_remaining')::bigint, 0);
  v_over := greatest(0, p_tokens - v_plan_left);   -- 제공량을 넘어선 만큼만
  if v_over = 0 then return true; end if;

  update public.credit_balances
     set ai_tokens = greatest(0, ai_tokens - v_over), updated_at = now()
   where company_id = p_company_id;
  return found;
end;
$$;

-- ⑤ 충전 적립 — 결제 성공 웹훅에서만 부른다(service role).
--    같은 결제를 두 번 받아도 한 번만 적립된다(status='paid' 가드 + provider_ref 유니크).
create or replace function public.apply_credit_purchase(p_purchase_id uuid)
returns boolean
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare r public.credit_purchases%rowtype;
begin
  select * into r from public.credit_purchases where id = p_purchase_id for update;
  if not found or r.status = 'paid' then
    return false;   -- 없거나 이미 적립됨(웹훅 중복 수신 방어)
  end if;

  insert into public.credit_balances (company_id) values (r.company_id)
    on conflict (company_id) do nothing;

  if r.kind = 'ai_tokens' then
    update public.credit_balances set ai_tokens = ai_tokens + r.quantity, updated_at = now()
     where company_id = r.company_id;
  else
    update public.credit_balances set issue_credits = issue_credits + r.quantity::int, updated_at = now()
     where company_id = r.company_id;
  end if;

  update public.credit_purchases set status = 'paid', paid_at = now() where id = r.id;
  return true;
end;
$$;

grant execute on function public.issue_allowance(uuid) to authenticated;
grant execute on function public.ai_token_allowance(uuid) to authenticated;
