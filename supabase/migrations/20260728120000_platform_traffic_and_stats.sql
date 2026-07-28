-- 운영자 대시보드 — 트래픽 수집 + 사용 지표 집계 (2026-07-28)
--   비로그인 방문자·페이지뷰가 어디에도 수집되지 않아 신규로 만든다.
--   개인정보: IP·User-Agent 원문을 저장하지 않는다. 방문자 구분은 클라가 만든
--   익명 난수 id(visitor_key) 뿐이라 개인정보처리방침 개정 없이 운용 가능.
--   ※ 이미 MCP 로 prod 적용됨 — 이 파일은 저장소 기록용(재실행해도 안전한 멱등 DDL).

create table if not exists public.page_views (
  id           bigserial primary key,
  path         text not null,
  visitor_key  text not null,          -- 브라우저 로컬 난수. 개인 식별 불가.
  is_auth      boolean not null default false,
  referrer_host text,                  -- 유입 도메인만 (전체 URL·쿼리 저장 안 함)
  company_id   uuid references public.companies(id),
  created_at   timestamptz not null default now()
);

create index if not exists page_views_created_idx on public.page_views (created_at desc);
create index if not exists page_views_path_idx    on public.page_views (created_at desc, path);
create index if not exists page_views_visitor_idx on public.page_views (created_at desc, visitor_key);

alter table public.page_views enable row level security;

-- 수집은 비로그인 방문자도 해야 하므로 anon/authenticated 모두 INSERT 허용.
--   조회는 운영자만 — 어떤 회사도 남의 트래픽을 볼 수 없다.
drop policy if exists page_views_insert_any on public.page_views;
create policy page_views_insert_any on public.page_views
  for insert to anon, authenticated with check (true);

drop policy if exists page_views_select_operator on public.page_views;
create policy page_views_select_operator on public.page_views
  for select to authenticated using (public.is_platform_operator());

comment on table public.page_views is
  '운영자 대시보드 트래픽 원천. IP/UA 미저장, visitor_key 는 브라우저 난수(개인 식별 불가).';

-- ── 집계 RPC 2종 ────────────────────────────────────────────────────────────
--   auth.users 는 클라에서 직접 못 읽으므로 SECURITY DEFINER 로 감싼다.
--   ⚠️ 두 함수 모두 첫 줄에서 운영자 여부를 확인하고, 아니면 즉시 예외.
--      (SECURITY DEFINER 는 RLS 를 우회하므로 게이트가 함수 안에 있어야 한다.)

create or replace function public.platform_usage_stats()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  result jsonb;
begin
  if not public.is_platform_operator() then
    raise exception '운영자만 조회할 수 있습니다' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'as_of', now(),
    'accounts', (
      select jsonb_build_object(
        'total',        count(*),
        'dau',          count(*) filter (where last_sign_in_at > now() - interval '1 day'),
        'wau',          count(*) filter (where last_sign_in_at > now() - interval '7 days'),
        'mau',          count(*) filter (where last_sign_in_at > now() - interval '30 days'),
        'never_signed_in', count(*) filter (where last_sign_in_at is null)
      ) from auth.users
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
        -- 무료 = 활성/체험 구독이 하나도 없는 회사
        'free',     count(*) filter (where s.id is null),
        'trialing', count(*) filter (where s.status = 'trialing'),
        'paid',     count(*) filter (where s.status = 'active' and coalesce(p.slug,'free') <> 'free')
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
$$;

create or replace function public.platform_traffic_stats(p_days integer default 14)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  d integer := least(greatest(coalesce(p_days, 14), 1), 90);
begin
  if not public.is_platform_operator() then
    raise exception '운영자만 조회할 수 있습니다' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'as_of', now(),
    'days', d,
    'totals', (
      select jsonb_build_object(
        'views_today',    count(*) filter (where (created_at at time zone 'Asia/Seoul')::date
                                              = (now() at time zone 'Asia/Seoul')::date),
        'visitors_today', count(distinct visitor_key) filter (where (created_at at time zone 'Asia/Seoul')::date
                                              = (now() at time zone 'Asia/Seoul')::date),
        'views',          count(*),
        'visitors',       count(distinct visitor_key),
        'guest_visitors', count(distinct visitor_key) filter (where not is_auth)
      ) from public.page_views where created_at > now() - make_interval(days => d)
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('date', dt, 'views', v, 'visitors', u) order by dt), '[]'::jsonb)
      from (
        select (created_at at time zone 'Asia/Seoul')::date as dt,
               count(*) as v, count(distinct visitor_key) as u
        from public.page_views where created_at > now() - make_interval(days => d)
        group by 1
      ) x
    ),
    'top_paths', (
      select coalesce(jsonb_agg(jsonb_build_object('path', path, 'views', v, 'visitors', u) order by v desc), '[]'::jsonb)
      from (
        select path, count(*) as v, count(distinct visitor_key) as u
        from public.page_views where created_at > now() - make_interval(days => d)
        group by 1 order by 2 desc limit 10
      ) y
    ),
    'top_referrers', (
      select coalesce(jsonb_agg(jsonb_build_object('host', h, 'visitors', u) order by u desc), '[]'::jsonb)
      from (
        select coalesce(nullif(referrer_host,''), '(직접 유입)') as h, count(distinct visitor_key) as u
        from public.page_views where created_at > now() - make_interval(days => d)
        group by 1 order by 2 desc limit 8
      ) z
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.platform_usage_stats()      from public, anon;
revoke all on function public.platform_traffic_stats(int) from public, anon;
grant execute on function public.platform_usage_stats()      to authenticated;
grant execute on function public.platform_traffic_stats(int) to authenticated;
