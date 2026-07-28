-- Migration: platform_activity_feed (2026-07-28)
-- 운영자 "시스템 상태" 통합 페이지 데이터 소스.
--   배경: 에러해석·의존성·사고기록·감사로그 4개 화면이 있었지만 정작 들어오는 데이터가
--   빈약해(에러 7일 0건, 감사=운영자 클릭 10건) 항상 비어 보였다. 비개발자 운영자가
--   원하는 건 "① 지금 문제 있나 ② 무슨 일이 있었나" — 실데이터 기반 신호등 + 사람언어 피드.
--
-- health: 최근 24h 영역별 실측 집계 / feed: 계정·회사·구독·고객활동(audit)·에러·운영자행동 통합 타임라인.
-- 게이트: is_platform_operator() (기존 OP RPC 패턴).

create or replace function public.platform_activity_feed(p_hours integer default 48, p_limit integer default 120)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v jsonb;
  h integer := least(greatest(coalesce(p_hours, 48), 1), 168);
  lim integer := least(greatest(coalesce(p_limit, 120), 10), 300);
  since timestamptz := now() - make_interval(hours => h);
  day_ago timestamptz := now() - interval '24 hours';
begin
  if not public.is_platform_operator() then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    'as_of', now(),
    'hours', h,

    -- 신호등 — 최근 24h 실측
    'health', jsonb_build_object(
      'signup', jsonb_build_object(
        'accounts', (select count(*) from auth.users where created_at > day_ago),
        'companies', (select count(*) from public.companies where created_at > day_ago)
      ),
      'payment', jsonb_build_object(
        'subs_started', (select count(*) from public.subscriptions where created_at > day_ago),
        'failures', (select count(*) from public.error_logs
                     where created_at > day_ago and message like '%stripe-checkout%')
      ),
      'errors_24h', (select count(*) from public.error_logs where created_at > day_ago),
      'notifications_24h', (select count(*) from public.notifications where created_at > day_ago),
      'active_users_24h', (select count(*) from auth.users where last_sign_in_at > day_ago)
    ),

    -- 통합 타임라인 (시간 역순)
    'feed', (
      select coalesce(jsonb_agg(row_to_json(f)::jsonb order by f.at desc), '[]'::jsonb)
      from (
        (
          select au.created_at as at, 'account'::text as kind, au.email as who,
                 coalesce(au.raw_app_meta_data->>'provider', 'email') as what,
                 null::text as extra
          from auth.users au where au.created_at > since
        )
        union all
        (
          select c.created_at, 'company', c.name, c.business_number, c.id::text
          from public.companies c where c.created_at > since
        )
        union all
        (
          select s.created_at, 'subscription', co.name, s.status, sp.name
          from public.subscriptions s
          join public.companies co on co.id = s.company_id
          left join public.subscription_plans sp on sp.id = s.plan_id
          where s.created_at > since
        )
        union all
        (
          select a.created_at, 'audit', co.name,
                 a.entity_type || '.' || a.action,
                 u.name
          from public.audit_logs a
          left join public.companies co on co.id = a.company_id
          left join public.users u on u.id = a.user_id
          where a.created_at > since
          order by a.created_at desc limit 150
        )
        union all
        (
          select e.created_at, 'error', coalesce(co.name, e.user_email),
                 e.message, e.error_type
          from public.error_logs e
          left join public.companies co on co.id = e.company_id
          where e.created_at > since
        )
        union all
        (
          select oa.created_at, 'operator', coalesce(oa.actor_email, '운영자'), oa.action, oa.target_type
          from public.operator_actions oa where oa.created_at > since
        )
        order by at desc limit lim
      ) f
    )
  ) into v;

  return v;
end;
$$;

revoke execute on function public.platform_activity_feed(integer, integer) from public, anon;
grant execute on function public.platform_activity_feed(integer, integer) to authenticated, service_role;
