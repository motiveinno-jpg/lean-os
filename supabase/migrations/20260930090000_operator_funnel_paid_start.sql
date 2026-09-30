-- 운영자 가입 퍼널의 마지막 단계를 '체험 시작'에서 '유료 결제 시작'으로
--   무료체험은 폐지됐다(무료는 무료 요금제뿐, 유료는 결제 즉시). 새 회사는 구독 없이 무료로 시작하므로
--   '체험 시작'은 늘 0이었고, 결제 수단 없이 켠 내부 구독(active)만 섞여 들어갔다.
--   이제 Stripe 구독이나 토스 자동결제 키가 붙은 구독(= 실제 돈이 나가는 구독)만 센다 — src/lib/subscription-fee isBilledSubscription 과 같은 기준.
--   반환 키 이름(trials)은 화면 호환으로 그대로 둔다. 테스트 회사 제외는 20260929140000 그대로.

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
      -- 'trials' 키 이름은 화면 호환으로 남긴다 — 뜻은 '유료 결제 시작'(실제 결제 수단이 붙은 구독).
      'trials',    (select count(*) from public.subscriptions s
                     where (s.created_at at time zone 'Asia/Seoul')::date = today
                       and (s.company_id is null or s.company_id <> all(v_test))
                       and s.status in ('active', 'past_due') and (s.stripe_subscription_id is not null or s.toss_billing_key is not null))
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
          and s.status in ('active', 'past_due') and (s.stripe_subscription_id is not null or s.toss_billing_key is not null)
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
                       and s.status in ('active', 'past_due') and (s.stripe_subscription_id is not null or s.toss_billing_key is not null))
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
  tri as (  -- 유료 결제 시작(키 이름 trials 는 화면 호환) — 실제 결제 수단이 붙은 구독만, 생성 기준
    select date_trunc(gran, s.created_at at time zone 'Asia/Seoul') as b, count(*) as trials
    from public.subscriptions s
    where s.status in ('active', 'past_due') and (s.stripe_subscription_id is not null or s.toss_billing_key is not null)
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
