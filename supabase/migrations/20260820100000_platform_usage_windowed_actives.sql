-- 운영자 분석: 활동 사용자에 기간 창 집계 추가 (2026-08-20 사장님: 사이드 카드가
-- 상단 일간/월간/연간 토글을 따르게). 기존 dau/wau/mau 에 90일/365일/1095일 창을 더한다.
-- 나머지 로직은 기존 platform_usage_stats 정의 그대로.

CREATE OR REPLACE FUNCTION public.platform_usage_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  result jsonb;
begin
  if not public.is_platform_operator() then
    raise exception '운영자만 조회할 수 있습니다' using errcode = '42501';
  end if;

  with acts as (
    -- 사용자별 마지막 활동 시각 (세 근거 중 가장 늦은 것)
    select au.id as auth_id,
           greatest(
             au.last_sign_in_at,
             (select max(al.created_at) from public.audit_logs al
                join public.users u2 on u2.id = al.user_id where u2.auth_id = au.id),
             (select max(pv.created_at) from public.page_views pv
                join public.users u3 on u3.company_id = pv.company_id
               where u3.auth_id = au.id and pv.is_auth)
           ) as last_active
    from auth.users au
  )
  select jsonb_build_object(
    'as_of', now(),
    -- 화면이 "언제부터의 수치인지" 밝힐 수 있도록 각 근거의 수집 시작일 노출
    'coverage', jsonb_build_object(
      'page_views_since', (select min(created_at) from public.page_views),
      'audit_logs_since', (select min(created_at) from public.audit_logs)
    ),
    'accounts', (
      select jsonb_build_object(
        'total',           count(*),
        'dau',             count(*) filter (where a.last_active > now() - interval '1 day'),
        'wau',             count(*) filter (where a.last_active > now() - interval '7 days'),
        'mau',             count(*) filter (where a.last_active > now() - interval '30 days'),
        'active_90d',      count(*) filter (where a.last_active > now() - interval '90 days'),
        'active_365d',     count(*) filter (where a.last_active > now() - interval '365 days'),
        'active_1095d',    count(*) filter (where a.last_active > now() - interval '1095 days'),
        'never_signed_in', count(*) filter (where a.last_active is null)
      ) from acts a
    ),
    'companies', (
      select jsonb_build_object(
        'total', count(*),
        'new_this_month', count(*) filter (
          where created_at >= date_trunc('month', now() at time zone 'Asia/Seoul'))
      ) from public.companies
    ),
    'plans', (
      select jsonb_build_object(
        'free',          count(*) filter (where s.id is null),
        'trialing',      count(*) filter (
                           where s.status = 'trialing'
                             and (s.trial_ends_at is null or s.trial_ends_at > now())),
        'trial_expired', count(*) filter (
                           where s.status = 'trialing' and s.trial_ends_at <= now()),
        'paid',          count(*) filter (
                           where s.status = 'active' and coalesce(p.slug,'free') <> 'free')
      )
      from public.companies c
      left join lateral (
        select s2.* from public.subscriptions s2
        where s2.company_id = c.id and s2.status in ('active','trialing')
        order by case s2.status when 'active' then 0 else 1 end
        limit 1
      ) s on true
      left join public.subscription_plans p on p.id = s.plan_id
    ),
    'activity_14d', (
      select coalesce(jsonb_agg(jsonb_build_object('date', d, 'count', n) order by d), '[]'::jsonb)
      from (
        select (created_at at time zone 'Asia/Seoul')::date as d, count(*) as n
        from public.audit_logs
        where created_at > now() - interval '14 days'
        group by 1
      ) x
    )
  ) into result;

  return result;
end;
$function$;
