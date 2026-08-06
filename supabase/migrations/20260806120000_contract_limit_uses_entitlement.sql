-- 전자계약 월 한도를 '유효 플랜' 기준으로 (2026-08-06 요금제 개편)
--   기존: 구독 행이 있는 회사만 검사 → 구독이 없는 무료 회사는 한도가 통째로 통과됐다.
--   변경: get_company_entitlement 로 실효 플랜(무료 포함)을 구해 그 플랜의 한도를 적용.
CREATE OR REPLACE FUNCTION public.enforce_contract_monthly_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_slug text;
  v_limit int;
  v_used  int;
  v_month_start timestamptz;
begin
  select effective_plan_slug into v_slug
    from public.get_company_entitlement(NEW.company_id);

  select sp.monthly_contract_limit into v_limit
    from public.subscription_plans sp
   where sp.slug = coalesce(v_slug, 'free');

  if v_limit is null then
    return NEW; -- 무제한
  end if;

  v_month_start := date_trunc('month', (now() at time zone 'Asia/Seoul')) at time zone 'Asia/Seoul';

  select count(*) into v_used
  from public.signature_requests
  where company_id = NEW.company_id
    and created_at >= v_month_start;

  if v_used >= v_limit then
    raise exception 'CONTRACT_LIMIT_EXCEEDED: 이번 달 전자계약 발송 한도(%건)를 모두 사용했습니다.', v_limit
      using errcode = 'P0001';
  end if;

  return NEW;
end;
$function$;
