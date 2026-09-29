-- 운영자 콘솔 집계에서 테스트 회사를 뺀다
--   자동 QA·검수가 만든 가짜 회사(QA시드 주식회사)와 그 계정들이 가입 수·회사 수·방문·오류·AI 비용·업종 평균에
--   그대로 섞여 실제 숫자를 볼 수 없었다.
--   · companies.is_test = 테스트 회사 표시. is_internal(자사 실사용 회사 — 모티브이노베이션·오너뷰)과 다르다.
--     is_internal 회사는 실제로 쓰는 회사라 집계에 남기고, is_test 회사만 뺀다.
--   · 운영자 RPC 는 시그니처·반환형·권한 게이트·search_path·grant 를 그대로 두고, 테스트 회사 행만 걸러낸다.
--     - 회사 행: companies.is_test
--     - 회사에 딸린 행(구독·감사로그·방문·AI 사용·월 재무 등): company_id 가 테스트 회사
--     - 계정(auth.users): public.users 로 테스트 회사에 속한 계정
--     - 오류(error_logs): company_id 가 테스트 회사이거나, 회사 없이 테스트 회사 계정 메일로 남은 것
--   · 방문 통계(page_views)는 테스트 회사로 로그인한 '행'만 뺀다. 방문자 키 단위로 빼면 같은 브라우저로 자사 회사에
--     들어온 기록까지 사라지므로 키 전체를 빼지 않는다. 내부 방문자 판정(keys)은 전과 같이 원본 창 전체로 한다.
--   · 회사 상세(get_company_overview)는 건드리지 않는다 — 운영자가 테스트 회사를 직접 열어 볼 수 있어야 한다.

-- ─────────────────────────────────────────────────────────────
-- 1) 테스트 회사 표시
-- ─────────────────────────────────────────────────────────────
alter table public.companies add column if not exists is_test boolean not null default false;

comment on column public.companies.is_test is
  '자동 QA·검수용 가짜 회사 — 운영자 콘솔 집계에서 뺀다. is_internal(자사 실사용 회사)과 다르며, 회사 상세 화면은 그대로 열린다. 브라우저 세션(anon/authenticated)은 바꿀 수 없다.';

update public.companies set is_test = true where id = '4d2157e8-35a2-4a78-8c6d-c774475ab110';

-- 고객이 자기 회사를 테스트로 표시해 운영자 집계에서 사라지거나, 테스트 표시를 풀 수 없게 막는다.
--   회사 대표는 companies UPDATE 가 허용돼 있어 컬럼 단위로 막아야 한다. service_role·postgres(SQL·서버)만 바꾼다.
create or replace function public.companies_is_test_guard()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.is_test := false;
    return new;
  end if;
  if new.is_test is distinct from old.is_test then
    raise exception '테스트 회사 표시는 바꿀 수 없습니다 (is_test is server-managed)' using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists companies_is_test_guard_trg on public.companies;
create trigger companies_is_test_guard_trg
  before insert or update of is_test on public.companies
  for each row execute function public.companies_is_test_guard();

-- 판정 한 곳 — 다른 함수·정책에서 회사 하나가 테스트인지 물을 때 쓴다(없는 회사·null 은 false).
create or replace function public.is_test_company(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((select c.is_test from public.companies c where c.id = p_company), false);
$function$;

revoke execute on function public.is_test_company(uuid) from public, anon;
grant execute on function public.is_test_company(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 2) 방문 통계 — platform_traffic_stats
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.platform_traffic_stats(p_days integer DEFAULT 14, p_scope text DEFAULT 'external'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result jsonb;
  d integer := least(greatest(coalesce(p_days, 14), 1), 90);
  sc text := case when p_scope in ('all', 'external', 'search') then p_scope else 'external' end;
  v_test uuid[] := array(select c.id from public.companies c where c.is_test);
begin
  if not public.is_platform_operator() then
    raise exception '운영자만 조회할 수 있습니다' using errcode = '42501';
  end if;

  with win as (
    -- 기간 안의 원본 방문 (test_row = 테스트 회사로 로그인한 방문)
    select pv.*, coalesce(pv.company_id = any(v_test), false) as test_row
    from public.page_views pv
    where pv.created_at > now() - make_interval(days => d)
  ),
  real_win as (
    -- 집계에 쓰는 방문 — 테스트 회사 행만 뺀다
    select * from win where not test_row
  ),
  dedup as (
    -- 같은 키·같은 경로가 60초 안에 다시 찍히면 한 번으로 접는다.
    --   order by created_at 이므로 먼저 온 행(= 진짜 리퍼러가 담긴 행)이 남는다.
    select * from (
      select w.*,
             lag(created_at) over (partition by visitor_key, path order by created_at) as prev_at
      from real_win w
    ) t
    where prev_at is null or created_at - prev_at > interval '60 seconds'
  ),
  keys as (
    -- 방문자(키) 단위 성격 — 기간 안에 검색 유입이 한 번이라도 있었는지.
    --   내부 판정은 테스트 행까지 포함한 원본으로 한다(테스트 행을 빼서 내부 방문자가 외부로 바뀌지 않게).
    select visitor_key,
           bool_or(public.pv_is_search_referrer(referrer_host)) as from_search,
           bool_or(is_internal) as internal,
           bool_or(not test_row) as has_real
    from win group by 1
  ),
  scoped as (
    select v.* from dedup v join keys k on k.visitor_key = v.visitor_key
    where case sc
            when 'all'      then true
            when 'external' then not k.internal
            else                 not k.internal and k.from_search
          end
  )
  select jsonb_build_object(
    'as_of', now(),
    'days', d,
    'scope', sc,
    'totals', (
      select jsonb_build_object(
        'views_today',    count(*) filter (where (created_at at time zone 'Asia/Seoul')::date
                                              = (now() at time zone 'Asia/Seoul')::date),
        'visitors_today', count(distinct visitor_key) filter (where (created_at at time zone 'Asia/Seoul')::date
                                              = (now() at time zone 'Asia/Seoul')::date),
        'views',          count(*),
        'visitors',       count(distinct visitor_key),
        'guest_visitors', count(distinct visitor_key) filter (where not is_auth)
      ) from scoped
    ),
    -- 범위와 무관하게 항상 같이 준다 — 화면에서 "무엇이 빠졌는지"를 보여주기 위한 값.
    'breakdown', (
      select jsonb_build_object(
        'internal_visitors', count(*) filter (where internal),
        'external_visitors', count(*) filter (where not internal),
        'search_visitors',   count(*) filter (where not internal and from_search),
        'raw_views',         (select count(*) from real_win),
        'deduped_views',     (select count(*) from dedup)
      ) from keys where has_real
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('date', dt, 'views', v, 'visitors', u) order by dt), '[]'::jsonb)
      from (
        select (created_at at time zone 'Asia/Seoul')::date as dt,
               count(*) as v, count(distinct visitor_key) as u
        from scoped group by 1
      ) x
    ),
    'top_paths', (
      select coalesce(jsonb_agg(jsonb_build_object('path', path, 'views', v, 'visitors', u) order by v desc), '[]'::jsonb)
      from (
        select path, count(*) as v, count(distinct visitor_key) as u
        from scoped group by 1 order by 2 desc limit 10
      ) y
    ),
    'top_referrers', (
      select coalesce(jsonb_agg(jsonb_build_object('host', h, 'visitors', u) order by u desc), '[]'::jsonb)
      from (
        (
          -- 외부 사이트 유입 — 호스트별 고유 방문자
          select referrer_host as h, count(distinct visitor_key) as u
          from scoped
          where coalesce(referrer_host, '') <> ''
          group by 1
        )
        union all
        (
          -- (직접 유입) = 기간 내 외부 리퍼러가 한 번도 없는 방문자만
          --   (외부에서 온 방문자의 내부 이동분이 직접 유입으로 이중 카운트되던 것 제거)
          select '(직접 유입)', count(*)::bigint
          from (
            select visitor_key from scoped
            group by visitor_key
            having bool_and(coalesce(referrer_host, '') = '')
          ) dv
          having count(*) > 0
        )
        order by u desc limit 8
      ) z
    )
  ) into result;

  return result;
end;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 3) 사용 지표 — platform_usage_stats
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.platform_usage_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  result jsonb;
  v_test uuid[] := array(select c.id from public.companies c where c.is_test);
  v_test_auth uuid[] := array(
    select u.auth_id from public.users u
    join public.companies c on c.id = u.company_id
    where c.is_test and u.auth_id is not null);
begin
  if not public.is_platform_operator() then
    raise exception '운영자만 조회할 수 있습니다' using errcode = '42501';
  end if;

  with acts as (
    -- 사용자별 마지막 활동 시각 (세 근거 중 가장 늦은 것) — 테스트 회사 계정 제외
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
    where au.id <> all(v_test_auth)
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
      where not is_test
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
      where not c.is_test
    ),
    'activity_14d', (
      select coalesce(jsonb_agg(jsonb_build_object('date', d, 'count', n) order by d), '[]'::jsonb)
      from (
        select (created_at at time zone 'Asia/Seoul')::date as d, count(*) as n
        from public.audit_logs
        where created_at > now() - interval '14 days'
          and (company_id is null or company_id <> all(v_test))
        group by 1
      ) x
    )
  ) into result;

  return result;
end;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 4) 가입 퍼널 — platform_signup_funnel
--   pending(회사 없는 계정)은 회사가 없어 테스트 여부를 알 수 없으므로 그대로 둔다.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.platform_signup_funnel(p_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  result jsonb;
  d integer := least(greatest(coalesce(p_days, 7), 1), 90);
  since timestamptz := now() - make_interval(days => d);
  today date := (now() at time zone 'Asia/Seoul')::date;
  v_test uuid[] := array(select c.id from public.companies c where c.is_test);
  v_test_auth uuid[] := array(
    select u.auth_id from public.users u
    join public.companies c on c.id = u.company_id
    where c.is_test and u.auth_id is not null);
begin
  if not public.is_platform_operator() then
    raise exception '운영자만 조회할 수 있습니다' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'as_of', now(),
    'days', d,
    'today', jsonb_build_object(
      'accounts',  (select count(*) from auth.users au
                     where (au.created_at at time zone 'Asia/Seoul')::date = today
                       and au.id <> all(v_test_auth)),
      'signed_in', (select count(*) from auth.users au
                     where (au.created_at at time zone 'Asia/Seoul')::date = today
                       and au.last_sign_in_at is not null
                       and au.id <> all(v_test_auth)),
      'companies', (select count(*) from public.companies c
                     where (c.created_at at time zone 'Asia/Seoul')::date = today
                       and not c.is_test),
      -- 만료된 체험은 '시작' 으로 세지 않는다(status 는 만료 후에도 trialing 으로 남는다).
      'trials',    (select count(*) from public.subscriptions s
                     where (s.created_at at time zone 'Asia/Seoul')::date = today
                       and (s.company_id is null or s.company_id <> all(v_test))
                       and (s.status = 'active'
                            or (s.status = 'trialing' and (s.trial_ends_at is null or s.trial_ends_at > now()))))
    ),
    'today_detail', jsonb_build_object(
      'accounts', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'email',      au.email,
          'provider',   coalesce(au.raw_app_meta_data->>'provider', 'email'),
          'created_at', au.created_at,
          'signed_in',  au.last_sign_in_at is not null,
          'company',    c.name
        ) order by au.created_at desc), '[]'::jsonb)
        from auth.users au
        left join public.users u on u.auth_id = au.id
        left join public.companies c on c.id = u.company_id
        where (au.created_at at time zone 'Asia/Seoul')::date = today
          and au.id <> all(v_test_auth)
      ),
      'companies', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', c.id, 'name', c.name, 'created_at', c.created_at
        ) order by c.created_at desc), '[]'::jsonb)
        from public.companies c
        where (c.created_at at time zone 'Asia/Seoul')::date = today
          and not c.is_test
      ),
      'trials', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'company_id', c.id, 'company', c.name, 'status', s.status, 'created_at', s.created_at
        ) order by s.created_at desc), '[]'::jsonb)
        from public.subscriptions s
        join public.companies c on c.id = s.company_id
        where (s.created_at at time zone 'Asia/Seoul')::date = today
          and not c.is_test
          and (s.status = 'active'
               or (s.status = 'trialing' and (s.trial_ends_at is null or s.trial_ends_at > now())))
      )
    ),
    'period', jsonb_build_object(
      'accounts',  (select count(*) from auth.users au
                     where au.created_at > since and au.id <> all(v_test_auth)),
      'signed_in', (select count(*) from auth.users au
                     where au.created_at > since and au.last_sign_in_at is not null
                       and au.id <> all(v_test_auth)),
      'companies', (select count(*) from public.companies c where c.created_at > since and not c.is_test),
      'trials',    (select count(*) from public.subscriptions s
                     where s.created_at > since
                       and (s.company_id is null or s.company_id <> all(v_test))
                       and (s.status = 'active'
                            or (s.status = 'trialing' and (s.trial_ends_at is null or s.trial_ends_at > now()))))
    ),
    'pending', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'email',        au.email,
        'created_at',   au.created_at,
        'last_sign_in', au.last_sign_in_at,
        'provider',     coalesce(au.raw_app_meta_data->>'provider', 'email'),
        'confirmed',    au.confirmed_at is not null
      ) order by au.created_at desc), '[]'::jsonb)
      from auth.users au
      left join public.users u on u.auth_id = au.id
      where (u.id is null or u.company_id is null)
        and au.created_at > now() - interval '30 days'
    )
  ) into result;

  return result;
end;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 5) 위험·성장 신호 — platform_ops_risk
--   영업코드 목록 자체는 코드 정보라 그대로, 사용·전환 건수에서만 테스트 회사를 뺀다.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.platform_ops_risk()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_result jsonb;
  v_test uuid[] := array(select c.id from public.companies c where c.is_test);
begin
  if not public.is_platform_operator() then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    'as_of', now(),
    'stale_join_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'company', c.name,
        'email', r.requester_email,
        'days', extract(day from now() - r.created_at)::int,
        'created_at', r.created_at
      ) order by r.created_at)
      from public.company_join_requests r
      join public.companies c on c.id = r.company_id
      where r.status = 'pending'
        and (r.expires_at is null or r.expires_at > now())
        and not c.is_test
    ), '[]'::jsonb),
    'dormant_companies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', d.name, 'plan', d.plan, 'last_seen', d.last_seen
      ) order by d.last_seen nulls first)
      from (
        select c.name,
               coalesce(sp.name, s.status) as plan,
               greatest(
                 (select max(au.last_sign_in_at) from public.users u join auth.users au on au.id = u.auth_id where u.company_id = c.id),
                 (select max(al.created_at) from public.audit_logs al where al.company_id = c.id),
                 (select max(pv.created_at) from public.page_views pv where pv.company_id = c.id)
               ) as last_seen
        from public.subscriptions s
        join public.companies c on c.id = s.company_id
        left join public.subscription_plans sp on sp.id = s.plan_id
        where s.status in ('active', 'trialing')
          and not c.is_test
      ) d
      where coalesce(d.last_seen, 'epoch'::timestamptz) < now() - interval '7 days'
    ), '[]'::jsonb),
    'email_failures', jsonb_build_object(
      'join_requests', (select count(*) from public.company_join_requests r
                        where r.delivery_status = 'failed' and r.created_at > now() - interval '30 days'
                          and (r.company_id is null or r.company_id <> all(v_test))),
      'billing', (select count(*) from public.billing_email_deliveries b
                  where b.status = 'failed' and b.created_at > now() - interval '30 days'
                    and (b.company_id is null or b.company_id <> all(v_test)))
    ),
    'sales_codes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', sc.code, 'owner', sc.owner_name, 'bonus_days', sc.bonus_trial_days,
        'active', sc.is_active,
        'redemptions', (select count(*) from public.sales_code_redemptions r
                         where r.sales_code_id = sc.id
                           and (r.company_id is null or r.company_id <> all(v_test))),
        'conversions', (select count(*) from public.sales_code_redemptions r
                         where r.sales_code_id = sc.id and r.converted_at is not null
                           and (r.company_id is null or r.company_id <> all(v_test)))
      ) order by sc.created_at desc)
      from public.sales_codes sc
    ), '[]'::jsonb),
    'deletions', jsonb_build_object(
      'd7', (select count(*) from public.account_deletions ad
              where ad.created_at > now() - interval '7 days'
                and (ad.company_id is null or ad.company_id <> all(v_test))),
      'd30', (select count(*) from public.account_deletions ad
               where ad.created_at > now() - interval '30 days'
                 and (ad.company_id is null or ad.company_id <> all(v_test)))
    )
  ) into v_result;

  return v_result;
end;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 6) 회사별 활동 — platform_company_activity
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.platform_company_activity()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare result jsonb;
begin
  if not public.is_platform_operator() then
    raise exception '운영자만 조회할 수 있습니다' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'company_id',   c.id,
    'company',      c.name,
    'last_login',   l.last_login,
    'last_activity', greatest(l.last_login, a.last_audit, v.last_view),
    'last_inquiry', q.last_inquiry
  ) order by greatest(l.last_login, a.last_audit, v.last_view) nulls last), '[]'::jsonb)
  into result
  from public.companies c
  left join lateral (select max(au.last_sign_in_at) as last_login
      from public.users u join auth.users au on au.id=u.auth_id where u.company_id=c.id) l on true
  left join lateral (select max(created_at) as last_audit
      from public.audit_logs where company_id=c.id) a on true
  left join lateral (select max(created_at) as last_view
      from public.page_views where company_id=c.id) v on true
  left join lateral (select max(pi.created_at) as last_inquiry
      from public.partnership_inquiries pi
      join public.users u2 on lower(u2.email)=lower(pi.email)
     where u2.company_id=c.id) q on true
  where not c.is_test;

  return result;
end;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 7) 분석 추이 — platform_analytics
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.platform_analytics(p_granularity text DEFAULT 'day'::text, p_buckets integer DEFAULT 30, p_scope text DEFAULT 'external'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  gran   text := case when p_granularity in ('day','month','year') then p_granularity else 'day' end;
  n      integer := case gran
                      when 'day'   then least(greatest(coalesce(p_buckets,30), 7), 60)
                      when 'month' then least(greatest(coalesce(p_buckets,12), 3), 24)
                      else              least(greatest(coalesce(p_buckets,3),  2), 6)
                    end;
  step   interval := case gran when 'day' then interval '1 day'
                               when 'month' then interval '1 month'
                               else interval '1 year' end;
  -- 현재 버킷 시작(KST 벽시계 기준)
  cur    timestamp := date_trunc(gran, now() at time zone 'Asia/Seoul');
  sc     text := case when p_scope in ('all','external','search') then p_scope else 'external' end;
  result jsonb;
  v_test uuid[] := array(select c.id from public.companies c where c.is_test);
  v_test_auth uuid[] := array(
    select u.auth_id from public.users u
    join public.companies c on c.id = u.company_id
    where c.is_test and u.auth_id is not null);
begin
  if not public.is_platform_operator() then
    raise exception '운영자만 조회할 수 있습니다' using errcode = '42501';
  end if;

  with buckets as (
    select (cur - (i * step)) as b_start,
           (cur - (i * step)) + step as b_end
    from generate_series(n - 1, 0, -1) as g(i)
  ),
  win as (
    select pv.*, coalesce(pv.company_id = any(v_test), false) as test_row
    from public.page_views pv
    where pv.created_at >= (cur - ((n - 1) * step)) at time zone 'Asia/Seoul'
  ),
  dedup as (  -- 같은 키·같은 경로 60초 내 재기록 접기 (platform_traffic_stats 와 동일 규칙) · 테스트 회사 행 제외
    select * from (
      select w.*, lag(created_at) over (partition by visitor_key, path order by created_at) as prev_at
      from win w
      where not w.test_row
    ) t
    where prev_at is null or created_at - prev_at > interval '60 seconds'
  ),
  keys as (   -- 내부 판정은 테스트 행까지 포함한 원본으로
    select visitor_key,
           bool_or(public.pv_is_search_referrer(referrer_host)) as from_search,
           bool_or(is_internal) as internal
    from win group by 1
  ),
  scoped as (
    select v.* from dedup v join keys k on k.visitor_key = v.visitor_key
    where case sc
            when 'all'      then true
            when 'external' then not k.internal
            else                 not k.internal and k.from_search
          end
  ),
  pv as (  -- 방문 (page_views, 2026-07-28~)
    select date_trunc(gran, created_at at time zone 'Asia/Seoul') as b,
           count(*) as views,
           count(distinct visitor_key) as visitors,
           count(distinct visitor_key) filter (where not is_auth) as guests
    from scoped group by 1
  ),
  pvi as (  -- 같은 버킷에서 제외된 내부 방문자 수 (무엇이 빠졌는지 화면에 보이게)
    select date_trunc(gran, v.created_at at time zone 'Asia/Seoul') as b,
           count(distinct v.visitor_key) as internal
    from dedup v join keys k on k.visitor_key = v.visitor_key
    where k.internal group by 1
  ),
  acc as (  -- 신규 계정 (테스트 회사 계정 제외)
    select date_trunc(gran, au.created_at at time zone 'Asia/Seoul') as b, count(*) as accounts
    from auth.users au
    where au.created_at >= (cur - ((n - 1) * step)) at time zone 'Asia/Seoul'
      and au.id <> all(v_test_auth)
    group by 1
  ),
  comp as (  -- 신규 회사 (테스트 회사 제외)
    select date_trunc(gran, c.created_at at time zone 'Asia/Seoul') as b, count(*) as companies
    from public.companies c
    where c.created_at >= (cur - ((n - 1) * step)) at time zone 'Asia/Seoul'
      and not c.is_test
    group by 1
  ),
  tri as (  -- 체험/구독 시작 (만료 방치된 trialing 도 "시작" 은 시작이므로 생성 기준으로 센다)
    select date_trunc(gran, s.created_at at time zone 'Asia/Seoul') as b, count(*) as trials
    from public.subscriptions s
    where s.status in ('active','trialing')
      and s.created_at >= (cur - ((n - 1) * step)) at time zone 'Asia/Seoul'
      and (s.company_id is null or s.company_id <> all(v_test))
    group by 1
  )
  select jsonb_build_object(
    'as_of', now(),
    'granularity', gran,
    'scope', sc,
    'page_views_since', (select min(created_at) from public.page_views),
    'buckets', coalesce(jsonb_agg(jsonb_build_object(
      'start',     to_char(b.b_start, 'YYYY-MM-DD'),
      'visitors',  coalesce(pv.visitors, 0),
      'views',     coalesce(pv.views, 0),
      'guests',    coalesce(pv.guests, 0),
      'internal',  coalesce(pvi.internal, 0),
      'accounts',  coalesce(acc.accounts, 0),
      'companies', coalesce(comp.companies, 0),
      'trials',    coalesce(tri.trials, 0)
    ) order by b.b_start), '[]'::jsonb)
  ) into result
  from buckets b
  left join pv   on pv.b   = b.b_start
  left join pvi  on pvi.b  = b.b_start
  left join acc  on acc.b  = b.b_start
  left join comp on comp.b = b.b_start
  left join tri  on tri.b  = b.b_start;

  return result;
end;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 8) AI 비용 — platform_ai_costs
--   테스트 회사 호출도 실제로 돈이 나간 것이라, 합계에서 뺀 금액을 excluded_test_usd 로 같이 준다.
--   회사당 상한 강제는 엣지(_shared/claude.ts)가 따로 하므로 여기 숫자와 무관하다.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.platform_ai_costs()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result jsonb;
  month_start timestamptz := (date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul');
  v_test uuid[] := array(select c.id from public.companies c where c.is_test);
begin
  if not public.is_platform_operator() then
    raise exception '운영자만 조회할 수 있습니다' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'as_of', now(),
    'month', to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM'),
    'total_usd', coalesce((select round(sum(cost_usd_estimate)::numeric, 4) from ai_usage_log
                            where created_at >= month_start
                              and (company_id is null or company_id <> all(v_test))), 0),
    'total_calls', coalesce((select count(*) from ai_usage_log
                              where created_at >= month_start
                                and (company_id is null or company_id <> all(v_test))), 0),
    'excluded_test_usd', coalesce((select round(sum(cost_usd_estimate)::numeric, 4) from ai_usage_log
                                    where created_at >= month_start and company_id = any(v_test)), 0),
    'companies', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb order by x.usd desc)
      from (
        select c.name as company, l.company_id,
               round(sum(l.cost_usd_estimate)::numeric, 4) as usd,
               count(*) as calls,
               sum(l.input_tokens + l.output_tokens) as tokens,
               jsonb_object_agg(l.feature, f.usd_by_feature) as by_feature
        from ai_usage_log l
        left join companies c on c.id = l.company_id
        join lateral (
          select round(sum(l2.cost_usd_estimate)::numeric, 4) as usd_by_feature
          from ai_usage_log l2
          where l2.company_id = l.company_id and l2.feature = l.feature and l2.created_at >= month_start
        ) f on true
        where l.created_at >= month_start
          and (l.company_id is null or l.company_id <> all(v_test))
        group by c.name, l.company_id
      ) x
    ), '[]'::jsonb),
    'cap_usd', 35
  ) into result;

  return result;
end;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 9) 실시간 활동 — platform_activity_feed
--   운영자 행동(operator_actions)은 운영자 기록이라 그대로 둔다.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.platform_activity_feed(p_hours integer DEFAULT 48, p_limit integer DEFAULT 120)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v jsonb;
  h integer := least(greatest(coalesce(p_hours, 48), 1), 168);
  lim integer := least(greatest(coalesce(p_limit, 120), 10), 300);
  since timestamptz := now() - make_interval(hours => h);
  day_ago timestamptz := now() - interval '24 hours';
  v_test uuid[] := array(select c.id from public.companies c where c.is_test);
  v_test_auth uuid[] := array(
    select u.auth_id from public.users u
    join public.companies c on c.id = u.company_id
    where c.is_test and u.auth_id is not null);
  v_test_emails text[] := array(
    select lower(u.email) from public.users u
    join public.companies c on c.id = u.company_id
    where c.is_test and u.email is not null);
begin
  if not public.is_platform_operator() then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    'as_of', now(),
    'hours', h,
    'health', jsonb_build_object(
      'signup', jsonb_build_object(
        'accounts', (select count(*) from auth.users au
                      where au.created_at > day_ago and au.id <> all(v_test_auth)),
        'companies', (select count(*) from public.companies c
                       where c.created_at > day_ago and not c.is_test)
      ),
      'payment', jsonb_build_object(
        'subs_started', (select count(*) from public.subscriptions s
                          where s.created_at > day_ago
                            and (s.company_id is null or s.company_id <> all(v_test))),
        'failures', (select count(*) from public.error_logs e
                     where e.created_at > day_ago and e.message like '%stripe-checkout%' and e.resolved = false
                       and not coalesce(e.company_id = any(v_test), false)
                       and not coalesce(lower(e.user_email) = any(v_test_emails), false))
      ),
      'errors_24h', (select count(*) from public.error_logs e
                     where e.created_at > day_ago and e.resolved = false
                       and not coalesce(e.company_id = any(v_test), false)
                       and not coalesce(lower(e.user_email) = any(v_test_emails), false)),
      'notifications_24h', (select count(*) from public.notifications nt
                            where nt.created_at > day_ago
                              and (nt.company_id is null or nt.company_id <> all(v_test))),
      'active_users_24h', (select count(*) from auth.users au
                            where au.last_sign_in_at > day_ago and au.id <> all(v_test_auth))
    ),
    'feed', (
      select coalesce(jsonb_agg(row_to_json(f)::jsonb order by f.at desc), '[]'::jsonb)
      from (
        (
          select au.created_at as at, 'account'::text as kind, au.email as who,
                 coalesce(au.raw_app_meta_data->>'provider', 'email') as what,
                 null::text as extra
          from auth.users au where au.created_at > since and au.id <> all(v_test_auth)
        )
        union all
        (
          select c.created_at, 'company', c.name, c.business_number, c.id::text
          from public.companies c where c.created_at > since and not c.is_test
        )
        union all
        (
          select s.created_at, 'subscription', co.name, s.status, sp.name
          from public.subscriptions s
          join public.companies co on co.id = s.company_id
          left join public.subscription_plans sp on sp.id = s.plan_id
          where s.created_at > since and not co.is_test
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
            and (a.company_id is null or a.company_id <> all(v_test))
          order by a.created_at desc limit 150
        )
        union all
        (
          select e.created_at, 'error', coalesce(co.name, e.user_email),
                 e.message, e.error_type
          from public.error_logs e
          left join public.companies co on co.id = e.company_id
          where e.created_at > since and e.resolved = false
            and not coalesce(e.company_id = any(v_test), false)
            and not coalesce(lower(e.user_email) = any(v_test_emails), false)
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
$function$;

-- ─────────────────────────────────────────────────────────────
-- 10) 오류 목록 — operator_recent_errors
--   OUT 컬럼(id·company_id·created_at …)과 이름이 겹치므로 선언부 조회는 전부 별칭으로 쓴다.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.operator_recent_errors(p_limit integer DEFAULT 100, p_hours integer DEFAULT 72)
 RETURNS TABLE(id uuid, company_id uuid, company_name text, user_email text, user_name text, source text, error_type text, message text, stack text, url text, context jsonb, resolved boolean, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_since timestamptz;
  v_limit integer;
  v_test uuid[] := array(select tc.id from public.companies tc where tc.is_test);
  v_test_emails text[] := array(
    select lower(tu.email) from public.users tu
    join public.companies tc on tc.id = tu.company_id
    where tc.is_test and tu.email is not null);
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'platform operator only' USING ERRCODE = '42501';
  END IF;

  v_since := now() - (COALESCE(p_hours, 72) || ' hours')::interval;
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);

  RETURN QUERY
  SELECT
    e.id, e.company_id, c.name AS company_name,
    e.user_email, e.user_name,
    e.source, e.error_type, e.message, e.stack, e.url,
    e.context, e.resolved, e.created_at
  FROM error_logs e
  LEFT JOIN companies c ON c.id = e.company_id
  WHERE e.created_at >= v_since
    AND NOT COALESCE(e.company_id = ANY(v_test), false)
    AND NOT COALESCE(lower(e.user_email) = ANY(v_test_emails), false)
  ORDER BY e.created_at DESC
  LIMIT v_limit;
END;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 11) 업종 미분류 회사 — operator_unclassified_companies
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.operator_unclassified_companies()
 RETURNS TABLE(id uuid, name text, business_number text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_platform_operator() then
    raise exception 'platform operator only' using errcode = '42501';
  end if;
  return query
  select c.id, c.name, c.business_number, c.created_at::timestamptz
  from companies c
  where (c.industry is null or c.industry = '')
    and not c.is_test
  order by c.created_at desc;
end;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 12) 업종 분포 — operator_industry_distribution
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.operator_industry_distribution()
 RETURNS TABLE(industry text, company_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'platform operator only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(NULLIF(c.industry, ''), '(미분류)')::text AS industry,
    count(*)::integer AS company_count
  FROM companies c
  WHERE NOT c.is_test
  GROUP BY COALESCE(NULLIF(c.industry, ''), '(미분류)')
  ORDER BY count(*) DESC, industry ASC;
END;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 13) 월 재무 표본 달 목록 — operator_financial_months
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.operator_financial_months()
 RETURNS TABLE(month text, company_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'platform operator only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT mf.month, count(DISTINCT mf.company_id)::integer AS company_count
  FROM monthly_financials mf
  WHERE NOT EXISTS (SELECT 1 FROM companies tc WHERE tc.id = mf.company_id AND tc.is_test)
  GROUP BY mf.month
  ORDER BY mf.month DESC;
END;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 14) 전체 평균 — operator_financial_averages
--   기본 달(가장 최근 달)도 테스트 회사를 뺀 표본에서 고른다(테스트 회사만 있는 달이 기본이 되지 않게).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.operator_financial_averages(p_month text DEFAULT NULL::text)
 RETURNS TABLE(metric text, label text, avg_value numeric, median_value numeric, p25_value numeric, p75_value numeric, min_value numeric, max_value numeric, stddev_value numeric, sample_size integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_month text;
  v_test uuid[] := array(select tc.id from public.companies tc where tc.is_test);
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'platform operator only' USING ERRCODE = '42501';
  END IF;

  IF p_month IS NULL OR p_month = '' THEN
    SELECT max(mf.month) INTO v_month FROM monthly_financials mf
    WHERE mf.company_id <> ALL(v_test);
  ELSE
    v_month := p_month;
  END IF;

  IF v_month IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT mf.* FROM monthly_financials mf
    WHERE mf.month = v_month AND mf.company_id <> ALL(v_test)
  ),
  metrics AS (
    SELECT 'revenue'::text AS m, '매출 (revenue)'::text AS l, revenue AS v FROM base
    UNION ALL
    SELECT 'total_income', '총수입', total_income FROM base
    UNION ALL
    SELECT 'total_expense', '총지출', total_expense FROM base
    UNION ALL
    SELECT 'fixed_cost', '고정비', fixed_cost FROM base
    UNION ALL
    SELECT 'variable_cost', '변동비', variable_cost FROM base
    UNION ALL
    SELECT 'net_cashflow', '순현금흐름', net_cashflow FROM base
    UNION ALL
    SELECT 'bank_balance', '월말 통장잔액', bank_balance FROM base
  )
  SELECT
    m AS metric,
    max(l) AS label,
    avg(v)::numeric AS avg_value,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY v)::numeric AS median_value,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY v)::numeric AS p25_value,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY v)::numeric AS p75_value,
    min(v)::numeric AS min_value,
    max(v)::numeric AS max_value,
    stddev_samp(v)::numeric AS stddev_value,
    count(v)::integer AS sample_size
  FROM metrics
  WHERE v IS NOT NULL
  GROUP BY m
  ORDER BY array_position(
    ARRAY['revenue','total_income','total_expense','fixed_cost','variable_cost','net_cashflow','bank_balance']::text[],
    m
  );
END;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 15) 업종별 평균 — operator_financial_averages_by_industry
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.operator_financial_averages_by_industry(p_month text DEFAULT NULL::text, p_industry text DEFAULT NULL::text)
 RETURNS TABLE(metric text, label text, avg_value numeric, median_value numeric, p25_value numeric, p75_value numeric, min_value numeric, max_value numeric, sample_size integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_month text;
  v_ind text;
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'platform operator only' USING ERRCODE = '42501';
  END IF;

  IF p_month IS NULL OR p_month = '' THEN
    SELECT max(mf.month) INTO v_month
    FROM monthly_financials mf
    WHERE NOT EXISTS (SELECT 1 FROM companies tc WHERE tc.id = mf.company_id AND tc.is_test);
  ELSE
    v_month := p_month;
  END IF;
  IF v_month IS NULL THEN RETURN; END IF;

  v_ind := NULLIF(btrim(COALESCE(p_industry, '')), '');

  RETURN QUERY
  WITH joined AS (
    SELECT mf.*
    FROM monthly_financials mf
    JOIN companies c ON c.id = mf.company_id
    WHERE mf.month = v_month
      AND NOT c.is_test
      AND (v_ind IS NULL OR c.industry = v_ind)
  ),
  metrics AS (
    SELECT 'revenue'::text AS m, '매출'::text AS l, revenue AS v FROM joined
    UNION ALL SELECT 'total_income', '총수입', total_income FROM joined
    UNION ALL SELECT 'total_expense', '총지출', total_expense FROM joined
    UNION ALL SELECT 'fixed_cost', '고정비', fixed_cost FROM joined
    UNION ALL SELECT 'variable_cost', '변동비', variable_cost FROM joined
    UNION ALL SELECT 'net_cashflow', '순현금흐름', net_cashflow FROM joined
    UNION ALL SELECT 'bank_balance', '월말 잔액', bank_balance FROM joined
  )
  SELECT
    m,
    max(l),
    avg(v)::numeric,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY v)::numeric,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY v)::numeric,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY v)::numeric,
    min(v)::numeric, max(v)::numeric,
    count(v)::integer
  FROM metrics
  WHERE v IS NOT NULL
  GROUP BY m
  ORDER BY array_position(
    ARRAY['revenue','total_income','total_expense','fixed_cost','variable_cost','net_cashflow','bank_balance']::text[],
    m
  );
END;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 16) 마케팅 방문 — operator_marketing_visits
--   공개 페이지(비로그인)만 세므로 테스트 회사 행은 거의 없지만, 같은 규칙으로 뺀다.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.operator_marketing_visits(p_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 7), 90));
  v_since timestamptz := (date_trunc('day', now() at time zone 'Asia/Seoul') - make_interval(days => v_days - 1)) at time zone 'Asia/Seoul';
  v_out jsonb;
  v_test uuid[] := array(select c.id from public.companies c where c.is_test);
begin
  if not public.is_platform_operator() then
    raise exception 'not authorized';
  end if;
  with win as (
    select * from page_views where created_at >= v_since
  ), dedup as (   -- 같은 키·같은 경로 60초 안 재기록 접기 (platform_analytics 와 같은 규칙) · 테스트 회사 행 제외
    select * from (
      select w.*, lag(created_at) over (partition by visitor_key, path order by created_at) prev_at
        from win w where not coalesce(w.company_id = any(v_test), false)
    ) t where prev_at is null or created_at - prev_at > interval '60 seconds'
  ), keys as (
    select visitor_key, bool_or(is_internal) internal from win group by 1
  ), pub as (     -- 공개 페이지(비로그인) · 우리 팀 제외
    select d.* from dedup d join keys k using (visitor_key) where not k.internal and not d.is_auth
  )
  select jsonb_build_object(
    'since', v_since,
    'visitors', (select count(distinct visitor_key) from pub),
    'views', (select count(*) from pub),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', dd, 'visitors', coalesce(n, 0)) order by dd)
        from (select generate_series(v_since at time zone 'Asia/Seoul', date_trunc('day', now() at time zone 'Asia/Seoul'), interval '1 day')::date dd) g
        left join (select (created_at at time zone 'Asia/Seoul')::date d, count(distinct visitor_key) n from pub group by 1) c on c.d = g.dd
    ), '[]'::jsonb),
    'paths', coalesce((
      select jsonb_agg(x order by visitors desc) from (
        select path, count(distinct visitor_key)::int visitors, count(*)::int views from pub group by path order by 2 desc limit 8
      ) x), '[]'::jsonb),
    'referrers', coalesce((
      select jsonb_agg(x order by visitors desc) from (
        select regexp_replace(referrer_host, '^www\.', '') host, count(distinct visitor_key)::int visitors
          from pub where referrer_host is not null and referrer_host not like '%owner-view.com'
         group by 1 order by 2 desc limit 8
      ) x), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 17) 페이지 체류 — operator_page_engagement
--   이미 내부 방문(is_internal)을 빼고 있어 테스트 회사 행은 대부분 걸러지지만, 같은 규칙으로 명시한다.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.operator_page_engagement(p_days integer DEFAULT 30, p_scope text DEFAULT 'public'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 180)));
  v_out jsonb;
  v_test uuid[] := array(select c.id from public.companies c where c.is_test);
begin
  if not public.is_platform_operator() then
    raise exception 'not authorized';
  end if;
  with v as (
    select path, duration_ms, max_scroll_pct, exit_kind, next_path, visitor_key
      from page_views
     where created_at >= v_since
       and not coalesce(is_internal, false)
       and not coalesce(company_id = any(v_test), false)
       and duration_ms is not null
       and (p_scope = 'all' or (p_scope = 'app') = is_auth)
  ), per as (
    select path,
           count(*)::int views,
           count(distinct visitor_key)::int visitors,
           (percentile_cont(0.5) within group (order by duration_ms) / 1000.0)::numeric(10,1) median_sec,
           (percentile_cont(0.75) within group (order by duration_ms) / 1000.0)::numeric(10,1) p75_sec,
           round(100.0 * count(*) filter (where duration_ms < 5000) / count(*))::int quick_exit_pct,
           round(100.0 * count(*) filter (where exit_kind = 'leave') / count(*))::int leave_pct,
           round(avg(max_scroll_pct))::int avg_scroll,
           jsonb_build_object(
             '0-25',   count(*) filter (where exit_kind = 'leave' and coalesce(max_scroll_pct, 0) < 25),
             '25-50',  count(*) filter (where exit_kind = 'leave' and max_scroll_pct >= 25 and max_scroll_pct < 50),
             '50-75',  count(*) filter (where exit_kind = 'leave' and max_scroll_pct >= 50 and max_scroll_pct < 75),
             '75-100', count(*) filter (where exit_kind = 'leave' and max_scroll_pct >= 75)
           ) leave_scroll
      from v group by path
  ), nxt as (
    select path, jsonb_agg(jsonb_build_object('path', next_path, 'n', n) order by n desc) next_top
      from (select path, next_path, count(*)::int n, row_number() over (partition by path order by count(*) desc) rn
              from v where exit_kind = 'navigate' and next_path is not null group by path, next_path) t
     where rn <= 3 group by path
  )
  select jsonb_build_object(
    'since', v_since,
    'scope', p_scope,
    'tracked_since', (select min(created_at) from page_views where duration_ms is not null),
    'total_views', (select count(*) from v),
    'pages', coalesce((select jsonb_agg(to_jsonb(per) || jsonb_build_object('next_top', coalesce(nxt.next_top, '[]'::jsonb)) order by per.views desc)
                         from per left join nxt using (path)), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$function$;

-- create or replace 는 기존 grant 를 유지하지만, 새로 만든 함수가 기본 권한으로 PUBLIC 에 열리지 않게 한 번 더 못박는다.
revoke execute on function public.platform_traffic_stats(integer, text) from public, anon;
revoke execute on function public.platform_usage_stats() from public, anon;
revoke execute on function public.platform_signup_funnel(integer) from public, anon;
revoke execute on function public.platform_ops_risk() from public, anon;
revoke execute on function public.platform_company_activity() from public, anon;
revoke execute on function public.platform_analytics(text, integer, text) from public, anon;
revoke execute on function public.platform_ai_costs() from public, anon;
revoke execute on function public.platform_activity_feed(integer, integer) from public, anon;
revoke execute on function public.operator_recent_errors(integer, integer) from public, anon;
revoke execute on function public.operator_unclassified_companies() from public, anon;
revoke execute on function public.operator_industry_distribution() from public, anon;
revoke execute on function public.operator_financial_months() from public, anon;
revoke execute on function public.operator_financial_averages(text) from public, anon;
revoke execute on function public.operator_financial_averages_by_industry(text, text) from public, anon;
revoke execute on function public.operator_marketing_visits(integer) from public, anon;
revoke execute on function public.operator_page_engagement(integer, text) from public, anon;
