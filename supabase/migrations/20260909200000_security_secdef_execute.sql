-- 보안 점검(2026-09-09) S01·S02·S03·S10·S13 + 실행 권한 전면 정비.
--
-- 핵심: PostgreSQL 은 새 함수에 PUBLIC 실행 권한을 기본으로 준다. anon/authenticated 만 REVOKE 해도
-- PUBLIC 을 통한 상속 권한이 남아 SECURITY DEFINER 함수 302개 전부가 익명으로도 실행 가능했다.
-- ① 모든 SECURITY DEFINER 함수에서 PUBLIC 실행 권한을 걷고, RLS 정책이 쓰는 함수만 anon·authenticated 에 명시 부여.
-- ② 앞으로 만들어지는 함수도 PUBLIC 을 받지 않게 기본 권한을 바꾼다.
-- ③ 가입 승인·근태 재계산·근태 판정·원가 재생성·집계 함수에 호출자 인증·회사 범위·업무 권한 검사를 넣는다.

-- ── 호출 주체 판별: 서버(service_role JWT) 또는 JWT 없는 직접 SQL(마이그레이션·크론) ──
create or replace function public.is_service_request()
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select case
    when nullif(current_setting('request.jwt.claims', true), '') is null then true
    else coalesce((current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role', false)
  end;
$$;
revoke all on function public.is_service_request() from public;
grant execute on function public.is_service_request() to anon, authenticated, service_role;

-- ── ① 모든 SECURITY DEFINER 함수: PUBLIC 회수, 정책이 부르는 것만 역할에 명시 부여 ──
do $$
declare
  f record;
  used text[];
begin
  select coalesce(array_agg(distinct m[1]), '{}') into used
  from (
    select regexp_matches(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''), '([a-z_][a-z0-9_]*)\s*\(', 'g') m
    from pg_policies p
  ) s;
  for f in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke execute on function public.%I(%s) from public', f.proname, f.args);
    if f.proname = any(used) then
      execute format('grant execute on function public.%I(%s) to anon, authenticated, service_role', f.proname, f.args);
    end if;
  end loop;
end $$;

-- ── ② 앞으로 만드는 함수는 PUBLIC 실행 권한 없이 ──
alter default privileges for role postgres in schema public revoke execute on functions from public;

-- ── S01 가입 승인: 승인자 사칭 차단 · 서버 전용 ──
CREATE OR REPLACE FUNCTION public.resolve_company_join_request(p_request_id uuid, p_action text, p_role text, p_reason text, p_resolver_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r_company uuid; r_role text; r_master boolean; req record; v_role text; v_name text; v_target_company uuid; v_caller uuid;
begin
  -- 호출 주체 검증: 서버(service_role)가 아니면 로그인한 본인만, 그것도 승인자 ID 가 자기 자신일 때만.
  --   종전엔 승인자 ID 를 호출자가 지정했고 PUBLIC 실행 권한이 남아 익명도 함수에 들어올 수 있었다.
  if not public.is_service_request() then
    if auth.uid() is null then
      return jsonb_build_object('error', 'unauthenticated');
    end if;
    select id into v_caller from public.users where auth_id = auth.uid() limit 1;
    if v_caller is null or v_caller is distinct from p_resolver_user_id then
      return jsonb_build_object('error', 'forbidden_resolver_mismatch');
    end if;
  end if;
  if p_action not in ('approve', 'reject') then
    return jsonb_build_object('error', 'bad_action');
  end if;
  select company_id, role, coalesce(is_master, false) into r_company, r_role, r_master from public.users where id = p_resolver_user_id;
  if r_company is null then
    return jsonb_build_object('error', 'resolver_no_company');
  end if;
  if not (r_master or r_role in ('owner', 'admin')) then
    return jsonb_build_object('error', 'forbidden_not_admin');
  end if;
  select * into req from public.company_join_requests where id = p_request_id for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if req.company_id <> r_company then
    return jsonb_build_object('error', 'forbidden_other_company');
  end if;
  if p_action = 'approve' and req.status = 'approved' then
    return jsonb_build_object('ok', true, 'status', 'approved', 'already', true,
      'requester_auth_id', req.requester_auth_id, 'granted_role', req.granted_role);
  end if;
  if p_action = 'reject' and req.status = 'rejected' then
    return jsonb_build_object('ok', true, 'status', 'rejected', 'already', true);
  end if;
  if req.status = 'pending' and req.expires_at is not null and req.expires_at < now() then
    update public.company_join_requests set status = 'expired' where id = req.id;
    return jsonb_build_object('error', 'expired');
  end if;
  if req.status <> 'pending' then
    return jsonb_build_object('error', 'already_resolved', 'status', req.status);
  end if;
  if p_action = 'reject' then
    update public.company_join_requests
      set status = 'rejected', resolved_by = p_resolver_user_id, resolved_at = now(),
          rejection_reason = nullif(btrim(coalesce(p_reason, '')), '')
      where id = req.id;
    insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id, is_read)
      values (req.company_id, req.requester_auth_id, 'company_join_request',
              '회사 가입 요청 결과', '가입 요청이 거절되었습니다. 자세한 내용은 메일을 확인해주세요.',
              'company_join_request', req.id, false);
    return jsonb_build_object('ok', true, 'status', 'rejected', 'requester_auth_id', req.requester_auth_id);
  end if;
  select company_id into v_target_company from public.users where auth_id = req.requester_auth_id;
  if v_target_company is not null and v_target_company <> r_company then
    return jsonb_build_object('error', 'requester_in_other_company');
  end if;
  v_role := case when p_role = 'admin' then 'admin' else 'employee' end;
  v_name := coalesce(req.requester_name, split_part(req.requester_email, '@', 1));
  insert into public.users (id, auth_id, email, name, company_id, role)
    values (req.requester_auth_id, req.requester_auth_id, req.requester_email, v_name, r_company, v_role)
    on conflict (id) do update set company_id = excluded.company_id, role = excluded.role, name = excluded.name;
  -- 2026-07-28: employees 연결/생성 — 승인된 직원이 구성원 목록·출퇴근에서 빠지던 결함 수정
  update public.employees
     set user_id = req.requester_auth_id,
         status = case when status = 'invited' then 'joined' else status end
   where company_id = r_company
     and (user_id = req.requester_auth_id or lower(email) = lower(req.requester_email));
  if not found then
    insert into public.employees (company_id, user_id, name, email, hire_date, status)
    values (r_company, req.requester_auth_id, v_name, req.requester_email,
            (now() at time zone 'Asia/Seoul')::date, 'joined');
  end if;
  update public.company_join_requests
    set status = 'approved', resolved_by = p_resolver_user_id, resolved_at = now(), granted_role = v_role
    where id = req.id;
  insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id, is_read)
    values (r_company, req.requester_auth_id, 'company_join_request',
            '회사 가입이 승인되었습니다', '가입이 승인되었습니다. 이제 회사 페이지를 사용할 수 있습니다.',
            'company_join_request', req.id, false);
  return jsonb_build_object('ok', true, 'status', 'approved',
    'requester_auth_id', req.requester_auth_id, 'granted_role', v_role);
end;
$function$;
revoke all on function public.resolve_company_join_request(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.resolve_company_join_request(uuid, text, text, text, uuid) to service_role;

-- ── S02 근태 재계산: 서버 전용 · 사용자는 자기 회사 + 근태 권한 · 기간 상한 ──
CREATE OR REPLACE FUNCTION public.recalculate_late_status_recent(p_days integer, p_company_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(updated_count bigint, promoted_to_late bigint, demoted_to_present bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cutoff date := (current_date - greatest(p_days, 0));
begin
  if p_days is null or p_days <= 0 then raise exception 'p_days must be > 0'; end if;
  if p_days > 366 then raise exception 'p_days must be <= 366'; end if;
  -- 서버 작업(service_role·직접 SQL)만 전 회사를 돌릴 수 있다. 로그인 사용자는 자기 회사, 그것도 근태 관리 권한이 있을 때만.
  if not public.is_service_request() then
    if auth.uid() is null then raise exception 'unauthenticated'; end if;
    if public.is_advisor_session() then raise exception 'forbidden'; end if;
    if not (public.is_company_admin() or public.has_perm('/attendance:records')) then raise exception 'forbidden'; end if;
    if p_company_id is null or p_company_id is distinct from public.get_my_company_id() then raise exception 'forbidden: company scope'; end if;
  end if;
  return query
  with before as (
    select ar.id, ar.status as old_status from public.attendance_records ar
     where ar.check_in is not null and ar.date >= v_cutoff
       and (p_company_id is null or ar.company_id = p_company_id)
  ),
  upd as (
    update public.attendance_records ar set check_in = ar.check_in
      from before b where ar.id = b.id
    returning b.old_status, ar.status as new_status
  )
  select count(*) filter (where old_status is distinct from new_status)::bigint,
         count(*) filter (where new_status = 'late' and old_status is distinct from 'late')::bigint,
         count(*) filter (where new_status = 'present' and old_status is distinct from 'present')::bigint
    from upd;
end $function$;
revoke all on function public.recalculate_late_status_recent(integer, uuid) from public, anon, authenticated;
grant execute on function public.recalculate_late_status_recent(integer, uuid) to service_role;

-- ── S03 근태 판정 재실행: 회사 일치를 권한보다 먼저 ──
CREATE OR REPLACE FUNCTION public.mark_attendance_late(p_employee_id uuid, p_date date, p_is_late boolean, p_late_minutes integer, p_is_holiday boolean DEFAULT NULL::boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := current_app_user_id();
  v_employee_user uuid;
  v_company uuid;
begin
  if v_user_id is null then raise exception 'unauthenticated'; end if;
  if public.is_advisor_session() then raise exception 'forbidden'; end if;
  select e.user_id, e.company_id into v_employee_user, v_company from public.employees e where e.id = p_employee_id;
  if v_company is null then raise exception 'employee not found'; end if;
  -- 회사 일치는 권한과 무관하게 먼저 — 종전엔 근태 권한이 있으면 타사 직원 ID 로도 통과했다.
  if v_company is distinct from public.get_my_company_id() then raise exception 'forbidden'; end if;
  if v_employee_user is distinct from v_user_id and not (public.is_company_admin() or public.has_perm('/attendance:records')) then raise exception 'forbidden'; end if;
  update public.attendance_records set check_in = check_in where employee_id = p_employee_id and date = p_date;
  return found;
end $function$;
revoke all on function public.mark_attendance_late(uuid, date, boolean, integer, boolean) from public, anon;
grant execute on function public.mark_attendance_late(uuid, date, boolean, integer, boolean) to authenticated, service_role;

-- ── S13 원가 재생성·원가 전표: 회사 범위 + 쓰기 권한 + 세무사 거부 ──
CREATE OR REPLACE FUNCTION public.rebuild_my_stock_costs()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.get_my_company_id() is null then raise exception '회사가 없습니다'; end if;
  if public.is_advisor_session() then raise exception '세무사 계정은 읽기 전용입니다'; end if;
  if not (public.is_company_admin() or public.has_perm('/inventory/profit:write')) then raise exception '원가 재계산 권한이 없습니다'; end if;
  return public.rebuild_stock_costs(public.get_my_company_id());
end $function$;
CREATE OR REPLACE FUNCTION public.make_my_cogs_voucher_draft(p_from date, p_to date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.get_my_company_id() is null then raise exception '회사가 없습니다'; end if;
  if public.is_advisor_session() then raise exception '세무사 계정은 읽기 전용입니다'; end if;
  if not (public.is_company_admin() or public.has_perm('/inventory/profit:write') or public.has_perm('/inventory/production:write')) then raise exception '원가 전표 작성 권한이 없습니다'; end if;
  return public.make_cogs_voucher_draft(public.get_my_company_id(), p_from, p_to);
end $function$;
revoke all on function public.rebuild_my_stock_costs() from public, anon;
grant execute on function public.rebuild_my_stock_costs() to authenticated, service_role;
revoke all on function public.make_my_cogs_voucher_draft(date, date) from public, anon;
grant execute on function public.make_my_cogs_voucher_draft(date, date) to authenticated, service_role;

-- ── S10 집계 함수: 자기 회사 범위만 (서버는 예외) ──
CREATE OR REPLACE FUNCTION public.ai_cost_used_this_month(p_company_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(sum(cost_usd_estimate), 0)
  from public.ai_usage_log
  where company_id = p_company_id
    and (public.is_service_request() or p_company_id = public.get_my_company_id())
    and created_at >= (date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul');
$function$;
CREATE OR REPLACE FUNCTION public.get_monthly_issue_usage(p_company_id uuid)
 RETURNS TABLE(tax_count integer, cash_count integer, total_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH m AS (
    SELECT (to_char((now() AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM') || '-01')::date AS month_start
  ),
  t AS (
    SELECT count(*)::int AS c FROM public.tax_invoices ti, m
     WHERE ti.company_id = p_company_id
       AND (public.is_service_request() OR p_company_id = public.get_my_company_id())
       AND ti.nts_issue_status = 'issued'
       AND ti.nts_issued_at >= (m.month_start::text || 'T00:00:00+09:00')::timestamptz
  ),
  c AS (
    SELECT count(*)::int AS c FROM public.cash_receipts cr, m
     WHERE cr.company_id = p_company_id
       AND (public.is_service_request() OR p_company_id = public.get_my_company_id())
       AND cr.source = 'codef'
       AND cr.status <> 'cancelled'
       AND cr.issue_date >= m.month_start
  )
  SELECT t.c, c.c, (t.c + c.c) FROM t, c;
$function$;
CREATE OR REPLACE FUNCTION public.leave_used_from_requests(p_employee uuid, p_year integer)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(sum(days), 0)
    from public.leave_requests
   where employee_id = p_employee and status = 'approved' and leave_type = 'annual'
     and exists (select 1 from public.employees e where e.id = p_employee and (public.is_service_request() or e.company_id = public.get_my_company_id()))
     and extract(year from start_date)::int = p_year;
$function$;
CREATE OR REPLACE FUNCTION public.storage_quota_params(p_company uuid)
 RETURNS TABLE(included_bytes bigint, per_unit_bytes bigint, extra_seats integer, storage_packs integer, effective_paid boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s record;
  v_incl bigint; v_unit bigint; v_incl_seats int; v_paid boolean := false;
begin
  if not public.is_service_request() and p_company is distinct from public.get_my_company_id() then
    raise exception 'forbidden: company scope';
  end if;
  select sub.seat_count, sub.storage_pack_count, sub.status, sub.trial_ends_at, sub.current_period_end,
         p.included_seats, p.included_storage_bytes, p.storage_per_unit_bytes, p.slug
    into s
  from public.subscriptions sub
  join public.subscription_plans p on p.id = sub.plan_id
  where sub.company_id = p_company
  order by sub.created_at desc limit 1;

  if not found then
    included_bytes := 524288000; per_unit_bytes := 10737418240;
    extra_seats := 0; storage_packs := 0; effective_paid := false;
    return next; return;
  end if;

  v_incl := coalesce(s.included_storage_bytes, 524288000);
  v_unit := coalesce(s.storage_per_unit_bytes, 10737418240);
  v_incl_seats := coalesce(s.included_seats, 0);

  if coalesce(s.slug, 'free') = 'free' then
    v_paid := false;
  elsif s.status = 'trialing' then
    v_paid := s.trial_ends_at is not null and s.trial_ends_at > now();
  elsif s.status in ('active', 'past_due', 'paused') then
    v_paid := s.current_period_end is null or s.current_period_end + interval '3 days' > now();
  else
    v_paid := false;
  end if;

  included_bytes := v_incl; per_unit_bytes := v_unit; effective_paid := v_paid;
  if v_paid then
    extra_seats := greatest(0, coalesce(s.seat_count, 1) - v_incl_seats);
    storage_packs := coalesce(s.storage_pack_count, 0);
  else
    -- 실효 무료: 좌석·팩 한도 없음. 파일은 남고 새 업로드만 막힌다(재결제 시 즉시 원복).
    extra_seats := 0; storage_packs := 0;
  end if;
  return next;
end $function$;
revoke all on function public.ai_cost_used_this_month(uuid) from public, anon;
revoke all on function public.get_monthly_issue_usage(uuid) from public, anon;
revoke all on function public.leave_used_from_requests(uuid, integer) from public, anon;
revoke all on function public.storage_quota_params(uuid) from public, anon;
grant execute on function public.ai_cost_used_this_month(uuid) to authenticated, service_role;
grant execute on function public.get_monthly_issue_usage(uuid) to authenticated, service_role;
grant execute on function public.leave_used_from_requests(uuid, integer) to authenticated, service_role;
grant execute on function public.storage_quota_params(uuid) to authenticated, service_role;

-- ── 회귀 점검: PUBLIC 실행 가능한 SECURITY DEFINER 함수는 0이어야 한다 ──
do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.prosecdef
     and (p.proacl is null or p.proacl::text like '{=X/%' or p.proacl::text like '%,=X/%');   -- 빈 grantee(=X) 가 PUBLIC
  if n > 0 then raise exception 'SECURITY DEFINER functions still executable by PUBLIC: %', n; end if;
end $$;
