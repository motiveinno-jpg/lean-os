-- 본인 결재·휴가 셀프 승인 금지 (2026-10-01 사장님: "휴가는 스스로 승인하면 안된다").
--
-- History
--   · leave_requests / approval_requests / approval_steps 의 쓰기 RLS 는 '같은 회사면 누구나'였고, 승인 권한 확인
--     (지정 승인자인가·본인이 아닌가)은 화면 코드(hr.ts approveLeaveRequest·approval-workflow approveStep)에만 있었다.
--     → 직원이 브라우저에서 자기 휴가를 status='approved' 로 바꾸거나, 결재 요청을 단계 승인 없이 'approved' 로 바꾼 뒤
--       apply_approval_side_effects 로 휴가 기록·연차 차감을 일으킬 수 있었다.
--   · 결재선 계산이 신청자 본인을 승인자로 넣었다(팀장 단계=본인 / 승인자 없으면 본인). 운영 실측: 본인 승인 단계 7건(휴가 4,
--     모티브 3·QA 시드 4) — 이미 끝난 결재라 데이터는 그대로 둔다(되돌릴 근거가 없다). 앞으로만 막는다.
--   · 화면은 이번 커밋에서 본인 자리를 건너뛰게 고쳤다(approval-workflow planPolicyStages). 여기는 DB 최종 방어선.
--
-- 규칙 (클라이언트 = current_user 가 authenticated/anon. SECURITY DEFINER 함수·서비스 키는 해당 칸만 예외)
--   1. [모든 경로] 결재 단계 승인자 ≠ 그 결재의 신청자. 휴가 신청의 승인자 지정(1·2차·단계) ≠ 휴가 당사자.
--   2. [모든 경로] 휴가 승인 기록의 approved_by 가 휴가 당사자 본인이면 거부 — 단 마스터 본인(위에 승인할 사람이 없음)은 직접 등록 허용.
--   3. [클라이언트] 결재 요청은 본인 이름으로만 만들고, 처음부터 'approved' 는 금액 기준 자동 승인(휴가·초과근무 제외)만.
--      'approved' 로 바꾸려면 모든 단계가 승인돼 있어야 한다. 신청자·회사는 못 바꾼다.
--   4. [클라이언트] 결재 단계는 그 결재의 신청자(만들 때)·관리자만 추가, 승인자·단계 번호는 못 바꾼다.
--   5. [클라이언트] 휴가 신청: 처음엔 '승인 대기'만. 승인·반려는 지금 단계의 지정 승인자(없으면 결재 관리자)만, 본인은 안 됨.
--      단계 승인은 지금 단계 한 칸만 pending→approved/rejected. 결재선·신청자는 못 바꾼다. 처리된 휴가 내용은 휴가 관리자만.
--      취소는 본인·휴가 관리자·결재 관리자. 삭제는 휴가 관리자만(화면 삭제 경로 없음).
--   관리자: 결재 = 마스터·/approvals (화면 currentUserIsManager(me,'/approvals') 와 같다) · 휴가 관리 = 마스터·/employees:leave.

-- ── 읽기 도우미 (트리거는 호출자 권한으로 돌아 RLS 에 안 보이는 행이 있을 수 있다) ──
create or replace function public._employee_user_id(p_employee uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select user_id from public.employees where id = p_employee
$$;
create or replace function public._approval_request_requester(p_request uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select requester_id from public.approval_requests where id = p_request
$$;
create or replace function public._approval_open_steps(p_request uuid)
returns table(total int, not_approved int) language sql stable security definer set search_path = public as $$
  select count(*)::int, count(*) filter (where status is distinct from 'approved')::int
    from public.approval_steps where request_id = p_request
$$;
create or replace function public._approval_policy_threshold(p_policy uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(auto_approve_threshold, 0) from public.approval_policies where id = p_policy
$$;
revoke all on function public._employee_user_id(uuid) from public, anon;
revoke all on function public._approval_request_requester(uuid) from public, anon;
revoke all on function public._approval_open_steps(uuid) from public, anon;
revoke all on function public._approval_policy_threshold(uuid) from public, anon;
grant execute on function public._employee_user_id(uuid) to authenticated;
grant execute on function public._approval_request_requester(uuid) to authenticated;
grant execute on function public._approval_open_steps(uuid) to authenticated;
grant execute on function public._approval_policy_threshold(uuid) to authenticated;

-- ── approval_steps ──
create or replace function public.approval_steps_guard_trg()
returns trigger language plpgsql set search_path = public as $$
declare v_requester uuid := public._approval_request_requester(new.request_id);
begin
  if new.approver_id is not null and new.approver_id = v_requester then
    raise exception '본인 결재의 승인자가 될 수 없습니다' using errcode = '42501';
  end if;
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    if public.current_app_user_id() is distinct from v_requester
       and not (public.is_company_admin() or public.has_perm('/approvals')) then
      raise exception '결재선은 결재를 올린 사람만 만들 수 있습니다' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.approver_id is distinct from old.approver_id or new.request_id is distinct from old.request_id
     or new.stage is distinct from old.stage then
    raise exception '결재선(승인자·단계)은 바꿀 수 없습니다' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists approval_steps_guard on public.approval_steps;
create trigger approval_steps_guard before insert or update on public.approval_steps
  for each row execute function public.approval_steps_guard_trg();

-- ── approval_requests ──
create or replace function public.approval_requests_guard_trg()
returns trigger language plpgsql set search_path = public as $$
declare v_me uuid; s record;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  v_me := public.current_app_user_id();
  if tg_op = 'INSERT' then
    if new.requester_id is distinct from v_me then
      raise exception '결재는 본인 이름으로만 올릴 수 있습니다' using errcode = '42501';
    end if;
    if new.status is distinct from 'pending' then
      if new.status = 'approved' and new.request_type not in ('leave', 'overtime')
         and public._approval_policy_threshold(new.policy_id) > 0
         and coalesce(new.amount, 0) < public._approval_policy_threshold(new.policy_id) then
        return new;   -- 금액 기준 자동 승인(회사 정책)
      end if;
      raise exception '결재는 승인 대기로만 올릴 수 있습니다' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.requester_id is distinct from old.requester_id or new.company_id is distinct from old.company_id then
    raise exception '결재 신청자·회사는 바꿀 수 없습니다' using errcode = '42501';
  end if;
  if new.status = 'approved' and old.status is distinct from 'approved' then
    select * into s from public._approval_open_steps(new.id);
    if coalesce(s.total, 0) = 0 or s.not_approved > 0 then
      raise exception '모든 결재 단계가 승인돼야 결재를 승인할 수 있습니다' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists approval_requests_guard on public.approval_requests;
create trigger approval_requests_guard before insert or update on public.approval_requests
  for each row execute function public.approval_requests_guard_trg();

-- ── leave_requests ──
create or replace function public.leave_requests_guard_trg()
returns trigger language plpgsql set search_path = public as $$
declare
  v_owner uuid;
  v_me uuid;
  v_appr_admin boolean;
  v_leave_admin boolean;
  v_cur uuid;
  v_cur_idx int;
  v_changed int;
  v_content_changed boolean;
begin
  v_owner := public._employee_user_id(coalesce(new.employee_id, old.employee_id));

  if tg_op = 'DELETE' then
    if current_user in ('authenticated', 'anon')
       and not (public.is_company_admin() or public.has_perm('/employees:leave')) then
      raise exception '휴가 기록은 휴가 관리자만 지울 수 있습니다' using errcode = '42501';
    end if;
    return old;
  end if;

  -- 규칙 1·2 (모든 경로)
  if v_owner is not null and (
       new.requested_approver_id = v_owner or new.second_approver_id = v_owner
       or exists (select 1 from jsonb_array_elements(coalesce(new.approval_steps, '[]'::jsonb)) st where st->>'approver_id' = v_owner::text)) then
    raise exception '본인은 자기 휴가의 승인자가 될 수 없습니다' using errcode = '42501';
  end if;
  if v_owner is not null and new.status in ('approved', 'first_approved')
     and (new.approved_by = v_owner or new.second_approved_by = v_owner)
     and (tg_op = 'INSERT' or new.approved_by is distinct from old.approved_by or new.second_approved_by is distinct from old.second_approved_by)
     and not exists (select 1 from public.users u where u.id = v_owner and u.is_master) then
    raise exception '본인 휴가는 스스로 승인할 수 없습니다' using errcode = '42501';
  end if;

  if current_user not in ('authenticated', 'anon') then return new; end if;

  -- 규칙 5 (클라이언트)
  if tg_op = 'INSERT' then
    if new.status is distinct from 'pending' or new.approved_by is not null or new.second_approved_by is not null
       or exists (select 1 from jsonb_array_elements(coalesce(new.approval_steps, '[]'::jsonb)) st where coalesce(st->>'status', 'pending') <> 'pending') then
      raise exception '휴가 신청은 승인 대기로만 올릴 수 있습니다' using errcode = '42501';
    end if;
    return new;
  end if;

  v_me := public.current_app_user_id();
  v_appr_admin := public.is_company_admin() or public.has_perm('/approvals');
  v_leave_admin := public.is_company_admin() or public.has_perm('/employees:leave');

  if new.employee_id is distinct from old.employee_id or new.company_id is distinct from old.company_id
     or new.requested_approver_id is distinct from old.requested_approver_id
     or new.second_approver_id is distinct from old.second_approver_id
     or (select coalesce(jsonb_agg(st->>'approver_id' order by o), '[]'::jsonb) from jsonb_array_elements(coalesce(new.approval_steps, '[]'::jsonb)) with ordinality t(st, o))
        is distinct from
        (select coalesce(jsonb_agg(st->>'approver_id' order by o), '[]'::jsonb) from jsonb_array_elements(coalesce(old.approval_steps, '[]'::jsonb)) with ordinality t(st, o)) then
    raise exception '휴가 신청자·결재선은 바꿀 수 없습니다' using errcode = '42501';
  end if;

  v_content_changed := row(new.leave_type, new.start_date, new.end_date, new.days, new.leave_unit, new.start_time, new.end_time)
                       is distinct from row(old.leave_type, old.start_date, old.end_date, old.days, old.leave_unit, old.start_time, old.end_time);
  if v_content_changed and not v_leave_admin and (old.status is distinct from 'pending' or v_me is distinct from v_owner) then
    raise exception '처리된 휴가나 남의 휴가 내용은 휴가 관리자만 바꿀 수 있습니다' using errcode = '42501';
  end if;

  if new.status is not distinct from old.status and new.approval_steps is not distinct from old.approval_steps
     and new.approved_by is not distinct from old.approved_by and new.second_approved_by is not distinct from old.second_approved_by then
    return new;
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    if v_me = v_owner or v_leave_admin or v_appr_admin then return new; end if;
    raise exception '이 휴가를 취소할 권한이 없습니다' using errcode = '42501';
  end if;
  if old.status in ('approved', 'rejected', 'cancelled') then
    raise exception '이미 처리된 휴가입니다' using errcode = '42501';
  end if;
  if new.status not in ('pending', 'first_approved', 'approved', 'rejected') then
    raise exception '휴가 상태가 올바르지 않습니다' using errcode = '42501';
  end if;
  if v_me is not distinct from v_owner then
    raise exception '본인 휴가는 스스로 승인·반려할 수 없습니다(취소만 할 수 있습니다)' using errcode = '42501';
  end if;

  if jsonb_array_length(coalesce(old.approval_steps, '[]'::jsonb)) > 0 then
    -- 단계 체인: 지금 단계(첫 pending) 한 칸만 바뀌어야 한다
    select (st->>'approver_id')::uuid, o::int into v_cur, v_cur_idx
      from jsonb_array_elements(old.approval_steps) with ordinality t(st, o)
     where coalesce(st->>'status', 'pending') = 'pending' order by o limit 1;
    if v_cur is null then raise exception '승인 대기 단계가 없습니다' using errcode = '42501'; end if;
    if not v_appr_admin and v_cur is distinct from v_me then
      raise exception '지금 단계의 승인자가 아닙니다' using errcode = '42501';
    end if;
    select count(*) into v_changed
      from jsonb_array_elements(old.approval_steps) with ordinality a(st, o)
      join jsonb_array_elements(new.approval_steps) with ordinality b(st, o) using (o)
     where coalesce(a.st->>'status', 'pending') is distinct from coalesce(b.st->>'status', 'pending')
       and (o <> v_cur_idx or coalesce(b.st->>'status', 'pending') not in ('approved', 'rejected'));
    if v_changed > 0 then
      raise exception '지금 단계만 승인·반려할 수 있습니다' using errcode = '42501';
    end if;
    if new.status = 'approved' and exists (select 1 from jsonb_array_elements(new.approval_steps) st where coalesce(st->>'status', 'pending') <> 'approved') then
      raise exception '모든 단계가 승인돼야 휴가가 승인됩니다' using errcode = '42501';
    end if;
  else
    -- (구) 1·2차
    v_cur := case when old.status = 'first_approved' then old.second_approver_id else old.requested_approver_id end;
    if not v_appr_admin and (v_cur is null or v_cur is distinct from v_me) then
      raise exception '지금 단계의 승인자가 아닙니다' using errcode = '42501';
    end if;
    if old.status = 'pending' and new.status = 'approved' and old.second_approver_id is not null then
      raise exception '2차 승인이 남아 있습니다' using errcode = '42501';
    end if;
    if old.status = 'pending' and new.status = 'first_approved' and old.second_approver_id is null then
      raise exception '2차 승인자가 없는 휴가입니다' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists leave_requests_guard on public.leave_requests;
create trigger leave_requests_guard before insert or update or delete on public.leave_requests
  for each row execute function public.leave_requests_guard_trg();
