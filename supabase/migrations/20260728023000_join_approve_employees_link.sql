-- Migration: join_approve_employees_link (2026-07-28 P0, 정식 배포일 스윕)
-- 결함류: "회사 연결은 됐는데 employees 행이 없는 계정" — 구성원 목록에 안 보이고
--   출퇴근 버튼이 조용히 무시됨(my-attendance-card: employeeId null 이면 no-op).
--   2026-07-16 "대표 본인 employees 누락" 수정 때 가입 경로(createCompanyWithOwner)만
--   고쳐졌고, 합류 승인 RPC(resolve_company_join_request)는 users 만 만들고 있었다.
--
-- 1) resolve_company_join_request 재정의 — 승인 시 employees 연결/생성 추가
-- 2) 백필 — 회사 소속인데 employees 행이 없는 기존 owner/admin/employee 계정
--    (partner 역할은 직원이 아니므로 제외)

create or replace function public.resolve_company_join_request(
  p_request_id uuid,
  p_action text,            -- 'approve' | 'reject'
  p_role text,              -- 'admin' | (그 외 전부 employee)
  p_reason text,
  p_resolver_user_id uuid   -- 처리자 public.users.id (API 가 인증에서 파생)
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r_company uuid;
  r_role text;
  req record;
  v_role text;
  v_name text;
  v_target_company uuid;
begin
  if p_action not in ('approve', 'reject') then
    return jsonb_build_object('error', 'bad_action');
  end if;

  -- 처리자 = owner/admin
  select company_id, role into r_company, r_role
    from public.users where id = p_resolver_user_id;
  if r_company is null then
    return jsonb_build_object('error', 'resolver_no_company');
  end if;
  if r_role not in ('owner', 'admin') then
    return jsonb_build_object('error', 'forbidden_not_admin');
  end if;

  -- 요청 행 잠금(동시 승인 직렬화)
  select * into req from public.company_join_requests where id = p_request_id for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if req.company_id <> r_company then
    return jsonb_build_object('error', 'forbidden_other_company');
  end if;

  -- 멱등: 이미 원하는 상태면 그대로 성공 반환
  if p_action = 'approve' and req.status = 'approved' then
    return jsonb_build_object('ok', true, 'status', 'approved', 'already', true,
      'requester_auth_id', req.requester_auth_id, 'granted_role', req.granted_role);
  end if;
  if p_action = 'reject' and req.status = 'rejected' then
    return jsonb_build_object('ok', true, 'status', 'rejected', 'already', true);
  end if;

  -- 만료 지연 처리
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
    -- 요청자 알림(무소속이라 회사 스코프 알림은 회사=대상회사로 기록)
    insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id, is_read)
      values (req.company_id, req.requester_auth_id, 'company_join_request',
              '회사 가입 요청 결과', '가입 요청이 거절되었습니다. 자세한 내용은 메일을 확인해주세요.',
              'company_join_request', req.id, false);
    return jsonb_build_object('ok', true, 'status', 'rejected', 'requester_auth_id', req.requester_auth_id);
  end if;

  -- approve — 요청자가 그 사이 다른 회사 소속이 됐으면 중단(강제 이동 금지)
  select company_id into v_target_company from public.users where auth_id = req.requester_auth_id;
  if v_target_company is not null and v_target_company <> r_company then
    return jsonb_build_object('error', 'requester_in_other_company');
  end if;

  v_role := case when p_role = 'admin' then 'admin' else 'employee' end;  -- owner 승격 절대 금지
  v_name := coalesce(req.requester_name, split_part(req.requester_email, '@', 1));

  insert into public.users (id, auth_id, email, name, company_id, role)
    values (req.requester_auth_id, req.requester_auth_id, req.requester_email, v_name, r_company, v_role)
    on conflict (id) do update set company_id = excluded.company_id, role = excluded.role, name = excluded.name;

  -- ★ 추가(2026-07-28): employees 연결 — 이메일로 미리 만들어 둔 행이 있으면 연결(joined),
  --   없으면 생성. 이게 없으면 승인된 직원이 구성원 목록에 없고 출퇴근을 기록할 수 없다.
  --   (invite-accept 경로와 동일한 결과 상태로 수렴)
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
$$;

revoke execute on function public.resolve_company_join_request(uuid, text, text, text, uuid) from anon, authenticated;

-- 2) 백필 — 회사 소속인데 employees 행이 없는 기존 계정 (partner 제외).
--   hire_date 는 계정 생성일로(오늘로 하면 과거 가입자의 근속이 왜곡됨).
insert into public.employees (company_id, user_id, name, email, position, hire_date, status)
select u.company_id, u.id,
       coalesce(nullif(u.name, ''), split_part(u.email, '@', 1)),
       u.email,
       case when u.role = 'owner' then '대표' else null end,
       u.created_at::date,
       'joined'
from public.users u
where u.company_id is not null
  and u.role in ('owner', 'admin', 'employee')
  and not exists (
    select 1 from public.employees e
    where e.company_id = u.company_id
      and (e.user_id = u.id or (e.email is not null and lower(e.email) = lower(u.email)))
  );
