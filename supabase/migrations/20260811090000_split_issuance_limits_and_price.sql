-- 요금제 개편 (2026-08-11 사장님): 오너뷰 39,000원(VAT 별도) + 발행 한도 종류별 분리
-- ① 플랜 데이터 — 합산 한도(monthly_issue_limit)는 폐기(null), 종류별 한도로 전환
update public.subscription_plans
   set base_price = 39000,
       monthly_tax_invoice_limit = 100,
       monthly_cashbill_limit = 100,
       monthly_issue_limit = null
 where slug = 'standard';

update public.subscription_plans
   set monthly_tax_invoice_limit = 5,
       monthly_cashbill_limit = 5,
       monthly_issue_limit = null
 where slug = 'free';

-- ② 종류별 발행 허용 판정 — 기존 issue_allowance(uuid) 는 그대로 두고(호환) 2-인자 오버로드 추가.
--    충전 잔액(credit_balances.issue_credits)은 종류 구분 없는 공용 주머니 유지.
create or replace function public.issue_allowance(p_company_id uuid, p_kind text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_slug text; v_limit int; v_used int; v_credits int; v_plan_left int;
begin
  select effective_plan_slug into v_slug from public.get_company_entitlement(p_company_id);
  v_slug := coalesce(v_slug, 'free');

  if p_kind = 'cash' then
    select monthly_cashbill_limit into v_limit from public.subscription_plans where slug = v_slug;
    select cash_count into v_used from public.get_monthly_issue_usage(p_company_id);
  else
    select monthly_tax_invoice_limit into v_limit from public.subscription_plans where slug = v_slug;
    select tax_count into v_used from public.get_monthly_issue_usage(p_company_id);
  end if;
  v_used := coalesce(v_used, 0);

  select coalesce(issue_credits, 0) into v_credits from public.credit_balances where company_id = p_company_id;
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
$function$;

grant execute on function public.issue_allowance(uuid, text) to authenticated, service_role;
