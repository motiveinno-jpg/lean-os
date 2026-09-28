-- 페이지 체류 — 어느 화면에서 몇 초 머물다, 어디까지 내려 보고, 다른 화면으로 갔는지·사이트를 떠났는지 (2026-09-28)
--   page_views 는 '열었다'만 적었다. 보완할 곳을 찾으려면 머문 시간과 떠난 지점이 필요하다.
--   · view_key        — 방문 한 건을 화면이 만든 무작위 키(uuid)로 가리킨다(행 id 를 브라우저가 읽을 수 없어서)
--   · duration_ms     — 화면이 보이던 시간만(다른 탭에 가 있던 시간은 빼고), 최대 2시간
--   · max_scroll_pct  — 가장 아래까지 내려 본 위치(0~100)
--   · exit_kind       — navigate(사이트 안 다른 화면으로) / leave(탭을 닫거나 다른 사이트로·백그라운드로 감)
--   · next_path       — navigate 일 때 다음 화면
--   개인 식별 정보는 여전히 없다 — 브라우저 난수 visitor_key 뿐.

alter table public.page_views
  add column if not exists view_key uuid,
  add column if not exists duration_ms integer,
  add column if not exists max_scroll_pct smallint,
  add column if not exists exit_kind text,
  add column if not exists next_path text,
  add column if not exists ended_at timestamptz;

alter table public.page_views drop constraint if exists page_views_exit_kind_check;
alter table public.page_views add constraint page_views_exit_kind_check
  check (exit_kind is null or exit_kind = any (array['navigate', 'leave']));

create unique index if not exists page_views_view_key_key on public.page_views (view_key) where view_key is not null;

-- 떠날 때 부른다(익명 가능). 같은 방문을 여러 번 불러도 된다 — 시간·스크롤은 큰 값, 떠난 방식은 마지막 값.
--   visitor_key 가 맞아야 하고, 6시간 지난 방문은 안 고친다(남의 행을 고치거나 오래된 통계를 흔들지 못하게).
create or replace function public.page_view_end(
  p_view_key uuid, p_visitor_key text, p_duration_ms integer, p_max_scroll_pct integer,
  p_exit_kind text default 'leave', p_next_path text default null)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update page_views
     set duration_ms    = greatest(coalesce(duration_ms, 0), least(greatest(coalesce(p_duration_ms, 0), 0), 7200000)),
         max_scroll_pct = greatest(coalesce(max_scroll_pct, 0), least(greatest(coalesce(p_max_scroll_pct, 0), 0), 100))::smallint,
         exit_kind      = case when p_exit_kind in ('navigate', 'leave') then p_exit_kind else exit_kind end,
         next_path      = case when p_exit_kind = 'navigate' then left(p_next_path, 300) else next_path end,
         ended_at       = now()
   where view_key = p_view_key
     and visitor_key = p_visitor_key
     and created_at > now() - interval '6 hours';
$$;
revoke all on function public.page_view_end(uuid, text, integer, integer, text, text) from public;
grant execute on function public.page_view_end(uuid, text, integer, integer, text, text) to anon, authenticated;

-- 운영자 › 페이지 체류 — 경로별 머문 시간·이탈·떠난 위치
--   p_scope: 'public'(비로그인 방문 = 공개 페이지) / 'app'(로그인 사용자 = 앱 화면) / 'all'
--   내부(우리 팀) 방문은 뺀다. 머문 시간이 기록된 방문만(체류 수집 시작 이후) 센다.
create or replace function public.operator_page_engagement(p_days integer default 30, p_scope text default 'public')
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 180)));
  v_out jsonb;
begin
  if not public.is_platform_operator() then
    raise exception 'not authorized';
  end if;
  with v as (
    select path, duration_ms, max_scroll_pct, exit_kind, next_path, visitor_key
      from page_views
     where created_at >= v_since
       and not coalesce(is_internal, false)
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
revoke all on function public.operator_page_engagement(integer, text) from public, anon;
grant execute on function public.operator_page_engagement(integer, text) to authenticated;
