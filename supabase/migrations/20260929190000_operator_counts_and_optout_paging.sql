-- 운영자 콘솔: 목록 상한과 전체 건수를 분리한다.
--   · 수신거부 목록(operator_list_email_optouts)은 행을 돌려주는 함수라 PostgREST 상한(1,000행)과
--     함수 안 상한(2,000)에 걸려 조용히 잘렸다. 발송 전 대조용 목록이 잘리면 거부한 주소로 다시 나간다.
--     → p_offset 을 받아 화면이 1,000행씩 끝까지 넘겨 받게 하고, 건수는 operator_email_optout_counts 로 따로 센다.
--   · 에러 해석은 최근 200건, 운영자 로그는 최근 500건만 불러오면서 그 개수를 "N건"으로 보여 줬다.
--     → 기간 안 전체 건수를 세는 함수를 두고, 화면은 "전체 N건 중 최근 M건"으로 적는다.
--     세는 조건은 목록 함수(operator_recent_errors / operator_list_actions)와 같다(테스트 회사 제외 포함).

-- ── 수신거부 목록: 페이지 단위 조회 ─────────────────────────────────────────
drop function if exists public.operator_list_email_optouts(integer, text);

create or replace function public.operator_list_email_optouts(
  p_limit integer default 500,
  p_search text default null,
  p_offset integer default 0
)
returns table(id uuid, email text, source text, note text, created_at timestamp with time zone)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_limit integer;
  v_offset integer;
  v_q text;
begin
  if not public.is_platform_operator() then
    raise exception 'not authorized';
  end if;

  -- 한 번에 1,000행까지(PostgREST 상한과 같게) — 더 필요하면 p_offset 으로 넘긴다
  v_limit := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  v_q := nullif(btrim(coalesce(p_search, '')), '');

  return query
  select eo.id, eo.email, eo.source, eo.note, eo.created_at
  from email_optouts eo
  where v_q is null
     or eo.email ilike '%' || v_q || '%'
     or coalesce(eo.note, '') ilike '%' || v_q || '%'
  order by eo.created_at desc, eo.id desc
  limit v_limit offset v_offset;
end;
$function$;

revoke execute on function public.operator_list_email_optouts(integer, text, integer) from public, anon;
grant execute on function public.operator_list_email_optouts(integer, text, integer) to authenticated, service_role;

-- ── 수신거부 건수 ───────────────────────────────────────────────────────────
create or replace function public.operator_email_optout_counts()
returns table(total bigint, by_self bigint, last_7d bigint)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not public.is_platform_operator() then
    raise exception 'not authorized';
  end if;

  return query
  select count(*)::bigint,
         count(*) filter (where eo.source = 'self')::bigint,
         count(*) filter (where eo.created_at >= now() - interval '7 days')::bigint
  from email_optouts eo;
end;
$function$;

revoke execute on function public.operator_email_optout_counts() from public, anon;
grant execute on function public.operator_email_optout_counts() to authenticated, service_role;

-- ── 에러 건수 (operator_recent_errors 와 같은 조건) ───────────────────────────
create or replace function public.operator_recent_error_counts(p_hours integer default 72)
returns table(total bigint, unresolved bigint)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_since timestamptz;
  v_test uuid[] := array(select tc.id from public.companies tc where tc.is_test);
  v_test_emails text[] := array(
    select lower(tu.email) from public.users tu
    join public.companies tc on tc.id = tu.company_id
    where tc.is_test and tu.email is not null);
begin
  if not public.is_platform_operator() then
    raise exception 'platform operator only' using errcode = '42501';
  end if;

  v_since := now() - (coalesce(p_hours, 72) || ' hours')::interval;

  return query
  select count(*)::bigint,
         count(*) filter (where not e.resolved)::bigint
  from error_logs e
  where e.created_at >= v_since
    and not coalesce(e.company_id = any(v_test), false)
    and not coalesce(lower(e.user_email) = any(v_test_emails), false);
end;
$function$;

revoke execute on function public.operator_recent_error_counts(integer) from public, anon;
grant execute on function public.operator_recent_error_counts(integer) to authenticated, service_role;

-- ── 운영자 로그 건수 (operator_list_actions 와 같은 조건) ─────────────────────
create or replace function public.operator_action_count(p_hours integer default 168)
returns bigint
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_n bigint;
begin
  if not public.is_platform_operator() then
    raise exception 'platform operator only' using errcode = '42501';
  end if;

  select count(*) into v_n
  from operator_actions a
  where a.created_at >= now() - (coalesce(p_hours, 168) || ' hours')::interval;
  return v_n;
end;
$function$;

revoke execute on function public.operator_action_count(integer) from public, anon;
grant execute on function public.operator_action_count(integer) to authenticated, service_role;
