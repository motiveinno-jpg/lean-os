-- 방문 집계 보정 — 내부 트래픽 분리 + 중복 뷰 접기 (2026-08-25 사장님 지시)
--
-- ■ History — 왜 지금 이 모양인가
--   page_views 는 2026-07-28 에 "운영자 대시보드 트래픽" 용도로 급히 붙였다(page-view-beacon.tsx).
--   개인정보 최소 수집 원칙으로 IP·User-Agent 를 아예 안 보내고, 방문자 구분을 localStorage
--   난수 visitor_key 하나에만 의존한다. 그 설계 자체는 유지한다 — 문제는 집계 쪽이다.
--
-- ■ 무엇이 틀렸나 (실측 근거)
--   ① 내부 트래픽이 외부 방문자로 섞여 들어온다.
--      visitor_key 가 localStorage 기반이라 우리 팀이 시크릿 창을 열 때마다 '새 방문자'가 된다.
--        · 08-13 21:26:14~45 (31초): 한 키가 계산기 4개를 순회 → 계산기 배포 당일 점검.
--        · 08-14 11:55:46~11:56:47 (61초): 서로 다른 4개 키가 각각 다른 계산기 하나씩.
--          사람 4명이 1분 안에 계산기를 하나씩 나눠 열 수는 없다.
--      전체로 보면 방문자 키 301개 중 62개가 내부인데 뷰의 93%(11,701/12,544)를 차지한다.
--   ② 방문 1회가 2회로 적힌다.
--      네이버에서 들어온 방문은 1초 뒤 같은 경로가 referrer 없이 한 번 더 적힌다
--      (referrerHost() 가 자기 도메인을 null 로 지운다 — "내부 이동은 유입이 아니다"는 기존 규칙).
--      실측: 12:38:21 naver → 12:38:22 (직접), 같은 키·같은 경로. 뷰가 정확히 2배가 된다.
--
-- ■ 결정
--   1) companies.is_internal — 우리 계정을 데이터로 표시한다. 클라이언트에 UUID 를 하드코딩하면
--      회사를 추가할 때마다 배포해야 하므로 DB 에 둔다.
--   2) page_views.is_internal — 방문 행에 내부 여부를 박아 둔다. 나중에 회사 소속이 바뀌어도
--      과거 집계가 흔들리지 않도록 '그때 판정'을 행에 남기는 쪽을 택했다.
--      (버린 안: 조회 시점에 company_id 로 매번 조인 — 로그아웃 상태 방문을 못 잡아 탈락)
--   3) 조회 함수에 범위(scope) 인자를 준다. all / external / search 세 단계.
--      search = 검색엔진 리퍼러가 찍힌 방문자. 이건 우리가 만들어낼 수 없는 기록이라
--      "확실한 외부 유입"의 하한선이 된다.
--   4) 중복 뷰는 조회 시점에 접는다(같은 키·같은 경로 60초 내 재방문 = 1회).
--      과거 데이터를 지우지 않고 읽을 때만 접으므로 원본은 보존된다.
--
--   적용 시점: 즉시. 기존 데이터 처리: 아래 소급 표시로 과거분도 함께 보정.

-- ── 1) 회사 단위 내부 표시 ──────────────────────────────────────────────
alter table public.companies
  add column if not exists is_internal boolean not null default false;

comment on column public.companies.is_internal is
  '우리(모티브이노베이션) 소유 계정 여부. 방문 집계에서 내부 트래픽으로 분리한다.';

update public.companies set is_internal = true
where id in (
  'c361afb9-8a52-4cac-add9-8992f0f7c09c',  -- (주)모티브이노베이션 — 우리 회사 본계정
  '4d2157e8-35a2-4a78-8c6d-c774475ab110',  -- QA시드 주식회사 — QA 시드 데이터 계정
  'f16442ea-2ad4-4b73-aed7-80df9d84ac8e'   -- 오너뷰 — 우리 데모/촬영용 계정
) and not is_internal;

-- ── 2) 방문 행 단위 내부 표시 ───────────────────────────────────────────
alter table public.page_views
  add column if not exists is_internal boolean not null default false;

comment on column public.page_views.is_internal is
  '내부(우리 팀) 방문 여부. 비콘이 판정해 보내고, 아래 소급 규칙으로 과거분도 표시했다.';

create index if not exists page_views_internal_created_idx
  on public.page_views (is_internal, created_at desc);

-- ── 3) 과거 데이터 소급 표시 ────────────────────────────────────────────
--   (a) 내부 회사로 로그인한 적이 있는 브라우저 = 그 브라우저의 모든 방문이 내부
--       (우리 팀은 로그아웃 상태로도 랜딩을 돌아다니므로 키 단위로 칠한다)
with internal_keys as (
  select distinct pv.visitor_key
  from public.page_views pv
  join public.companies c on c.id = pv.company_id
  where c.is_internal
)
update public.page_views pv
   set is_internal = true
  from internal_keys k
 where pv.visitor_key = k.visitor_key
   and not pv.is_internal;

--   (b) 로그인 흔적이 없는 배포 점검 방문 — 위 ①에서 시각으로 특정한 키들.
--       휴리스틱(예: "5분 내 계산기 3개 이상")으로 자동 판정하면 나중에 진짜 사용자를
--       잘못 지울 수 있어, 근거가 확인된 키만 명시적으로 적는다.
update public.page_views set is_internal = true
where visitor_key in (
  'eae85a5ed0354a8f94603b24',  -- 08-13 21:26 계산기 4개 31초 순회 (배포 당일 점검)
  '16c51acc9a8b4e9c9b3ef4db',  -- 08-14 11:55:46 salary
  'c7a772c8d9664ad1bf3ae7b9',  -- 08-14 11:55:58 leave
  '37260a8444354df7a8b0ce78',  -- 08-14 11:56:35 insurance
  'cb04fa2f7ae2497486c5c172'   -- 08-14 11:56:47 severance   ← 위 4개가 61초 안의 한 묶음
) and not is_internal;

-- ── 4) 검색엔진 리퍼러 판정 ─────────────────────────────────────────────
--   화이트리스트로 둔다. 블랙리스트(OAuth·자사 도메인 제외)로 하면 새 도메인이 생길 때마다
--   조용히 '검색 유입'으로 새어 들어온다.
create or replace function public.pv_is_search_referrer(p_host text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_host, '') ~ '(^|\.)(google\.[a-z.]+|search\.naver\.com|m\.search\.naver\.com|bing\.com|search\.daum\.net|duckduckgo\.com|search\.yahoo\.[a-z.]+)$'
$$;

comment on function public.pv_is_search_referrer(text) is
  '검색엔진 유입 여부. OAuth 리다이렉트(nid.naver.com·kauth.kakao.com·accounts.google.com)와 자사 도메인은 유입이 아니므로 제외된다.';

-- ── 5) 트래픽 통계 — 범위 인자 + 중복 뷰 접기 ───────────────────────────
--   ⚠️ 인자가 늘면 create or replace 는 '교체'가 아니라 '과부하 추가'가 된다.
--      옛 1-인자 함수가 남아 있으면 supabase-js 가 그쪽으로 붙어 보정이 적용되지 않는다. 반드시 drop.
drop function if exists public.platform_traffic_stats(integer);

create or replace function public.platform_traffic_stats(
  p_days  integer default 14,
  p_scope text    default 'external'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  result jsonb;
  d integer := least(greatest(coalesce(p_days, 14), 1), 90);
  sc text := case when p_scope in ('all', 'external', 'search') then p_scope else 'external' end;
begin
  if not public.is_platform_operator() then
    raise exception '운영자만 조회할 수 있습니다' using errcode = '42501';
  end if;

  with win as (
    -- 기간 안의 원본 방문
    select * from public.page_views
    where created_at > now() - make_interval(days => d)
  ),
  dedup as (
    -- 같은 키·같은 경로가 60초 안에 다시 찍히면 한 번으로 접는다.
    --   order by created_at 이므로 먼저 온 행(= 진짜 리퍼러가 담긴 행)이 남는다.
    select * from (
      select w.*,
             lag(created_at) over (partition by visitor_key, path order by created_at) as prev_at
      from win w
    ) t
    where prev_at is null or created_at - prev_at > interval '60 seconds'
  ),
  keys as (
    -- 방문자(키) 단위 성격 — 기간 안에 검색 유입이 한 번이라도 있었는지
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
        'raw_views',         (select count(*) from win),
        'deduped_views',     (select count(*) from dedup)
      ) from keys
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

-- ── 6) 성장 분석 버킷 — 같은 범위·같은 중복 접기 적용 ────────────────────
drop function if exists public.platform_analytics(text, integer);

create or replace function public.platform_analytics(
  p_granularity text    default 'day',
  p_buckets     integer default 30,
  p_scope       text    default 'external'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
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
    select * from public.page_views
    where created_at >= (cur - ((n - 1) * step)) at time zone 'Asia/Seoul'
  ),
  dedup as (  -- 같은 키·같은 경로 60초 내 재기록 접기 (platform_traffic_stats 와 동일 규칙)
    select * from (
      select w.*, lag(created_at) over (partition by visitor_key, path order by created_at) as prev_at
      from win w
    ) t
    where prev_at is null or created_at - prev_at > interval '60 seconds'
  ),
  keys as (
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
  acc as (  -- 신규 계정
    select date_trunc(gran, created_at at time zone 'Asia/Seoul') as b, count(*) as accounts
    from auth.users
    where created_at >= (cur - ((n - 1) * step)) at time zone 'Asia/Seoul'
    group by 1
  ),
  comp as (  -- 신규 회사
    select date_trunc(gran, created_at at time zone 'Asia/Seoul') as b, count(*) as companies
    from public.companies
    where created_at >= (cur - ((n - 1) * step)) at time zone 'Asia/Seoul'
    group by 1
  ),
  tri as (  -- 체험/구독 시작 (만료 방치된 trialing 도 "시작" 은 시작이므로 생성 기준으로 센다)
    select date_trunc(gran, created_at at time zone 'Asia/Seoul') as b, count(*) as trials
    from public.subscriptions
    where status in ('active','trialing')
      and created_at >= (cur - ((n - 1) * step)) at time zone 'Asia/Seoul'
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
