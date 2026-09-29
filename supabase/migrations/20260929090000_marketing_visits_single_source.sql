-- 마케팅 지표의 '방문'을 대시보드와 같은 원천·같은 규칙으로 (2026-09-29)
--   대시보드 방문자 = page_views 의 사람 수(visitor_key 한 번), 우리 팀 제외, 자동화 제외, 같은 경로 60초 재기록 접기.
--   마케팅 지표 방문   = marketing_events 의 page_view '조회 건수' — 사람이 아니라 조회 수, 우리 팀·자동화(테스트 브라우저)
--   포함, 재기록 그대로. 9/28 하루 대시보드 45명 vs 마케팅 145로 벌어졌다.
--   → 방문 계열(방문자·일별·인기 페이지·유입 출처)은 page_views 를 platform_analytics 와 같은 규칙으로 읽는다.
--   → 나머지 퍼널 이벤트(가입 버튼 등)는 marketing_events.is_internal 로 우리 팀을 뺀다(자동화는 수집 단계에서 안 보냄).

alter table public.marketing_events add column if not exists is_internal boolean not null default false;
create index if not exists marketing_events_created_internal_idx on public.marketing_events (created_at desc, is_internal);

create or replace function public.operator_marketing_visits(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 7), 90));
  v_since timestamptz := (date_trunc('day', now() at time zone 'Asia/Seoul') - make_interval(days => v_days - 1)) at time zone 'Asia/Seoul';
  v_out jsonb;
begin
  if not public.is_platform_operator() then
    raise exception 'not authorized';
  end if;
  with win as (
    select * from page_views where created_at >= v_since
  ), dedup as (   -- 같은 키·같은 경로 60초 안 재기록 접기 (platform_analytics 와 같은 규칙)
    select * from (
      select w.*, lag(created_at) over (partition by visitor_key, path order by created_at) prev_at from win w
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
revoke all on function public.operator_marketing_visits(integer) from public, anon;
grant execute on function public.operator_marketing_visits(integer) to authenticated;
