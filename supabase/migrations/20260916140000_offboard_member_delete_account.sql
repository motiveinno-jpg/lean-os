-- 퇴사 처리 = 회사 접근 회수 + 로그인 계정 삭제.
--   요구(2026-09-16): 퇴사자는 로그인 자체가 막혀야 하고, 같은 이메일로 다른 회사에서 새로 가입할 수 있어야 한다.
--
--   방법:
--     · auth.users 행을 삭제 → 로그인 불가 + 그 이메일이 다시 가입에 쓸 수 있게 풀린다(세션·아이덴티티는 auth 내부 cascade 정리).
--     · public.users 는 회사 데이터(board_posts·documents·approvals·chat 등)가 NO ACTION FK 로 참조해 삭제하면 막히거나
--       개인 데이터가 딸려 지워진다. 그래서 '묘비'로 남긴다 — 회사소속(company_id)·auth 링크(auth_id) 제거,
--       email 은 전역 유일(NOT NULL)이라 재가입을 막지 않도록 유일 토큰으로 치환한다. 귀속용 이름은 보존.
--     · 접근 회수·계정 삭제는 특권이므로 마스터 또는 권한관리(/employees:permissions) 권한자만. 마스터 계정은 보호.

create or replace function public.offboard_member(p_employee_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller_company uuid;
  v_authorized boolean;
  v_emp_company uuid;
  v_emp_user uuid;
  v_target_master boolean;
  v_auth_id uuid;
  v_deleted_auth int := 0;
begin
  select company_id into v_caller_company from users where auth_id = auth.uid();
  if v_caller_company is null then raise exception '회사 소속이 없습니다'; end if;

  select company_id, user_id into v_emp_company, v_emp_user from employees where id = p_employee_id;
  if v_emp_company is null then raise exception '구성원을 찾을 수 없습니다'; end if;
  if v_emp_company <> v_caller_company then raise exception '다른 회사의 구성원은 처리할 수 없습니다'; end if;

  v_authorized := public.is_company_master() or coalesce(public.has_perm('/employees:permissions'), false);
  if not v_authorized then raise exception '퇴사 처리 권한이 없습니다 (마스터 또는 권한관리 권한 필요)'; end if;

  -- 연결된 로그인 계정이 없으면(초대 미수락 등) 여기서 끝
  if v_emp_user is null then
    return json_build_object('ok', true, 'account', false);
  end if;

  select coalesce(is_master, false), auth_id into v_target_master, v_auth_id from users where id = v_emp_user;
  if coalesce(v_target_master, false) then raise exception '마스터 계정은 퇴사 처리로 삭제할 수 없습니다'; end if;

  -- 1) public.users 묘비화 — 회사 접근 끊기 + 이메일 해제(귀속 이름은 보존). id 는 회사 데이터 FK 때문에 그대로 둔다.
  update users
     set company_id = null,
         auth_id = null,
         email = 'former+' || v_emp_user::text || '@removed.invalid'
   where id = v_emp_user and coalesce(is_master, false) = false;

  -- 2) auth 계정 삭제 — 로그인 차단 + 원래 이메일 재사용 가능.
  if v_auth_id is not null then
    delete from auth.users where id = v_auth_id;
    get diagnostics v_deleted_auth = row_count;
  end if;
  if v_deleted_auth = 0 then
    -- 레거시(auth_id 비어 있던 경우) — users.id 가 곧 auth id 다.
    delete from auth.users where id = v_emp_user;
    get diagnostics v_deleted_auth = row_count;
  end if;

  return json_build_object('ok', true, 'account', true, 'auth_deleted', v_deleted_auth);
end;
$$;

revoke all on function public.offboard_member(uuid) from public, anon;
grant execute on function public.offboard_member(uuid) to authenticated;

-- 앞선 접근-회수 전용 함수는 offboard_member 로 합쳐져 더 이상 쓰지 않는다.
drop function if exists public.revoke_member_access(uuid);
