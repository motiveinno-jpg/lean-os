-- 퇴사 처리 시 회사 접근 회수.
--   문제(2026-09-16): 퇴사 처리는 employees.status='inactive' 만 바꾸고 users.company_id 는 그대로 둬서,
--     퇴사자가 로그인해 회사 데이터(RLS = get_my_company_id() = users.company_id)를 전부 볼 수 있었다.
--   해결: 대상 구성원의 users.company_id 를 NULL 로 끊어 RLS 접근을 회수한다.
--
--   ⚠️ 접근 회수는 특권 행위다. employees UPDATE 는 회사 아무 멤버나 되지만(정책 "Company can manage employees"),
--      이 함수는 마스터 또는 접근관리 권한자(/employees:permissions)만 호출할 수 있게 좁힌다 — 멤버가 서로 쫓아내지 못하게.
--      마스터 계정은 회수 대상에서 보호한다.

create or replace function public.revoke_member_access(p_employee_id uuid)
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
  v_count int := 0;
begin
  select company_id into v_caller_company from users where auth_id = auth.uid();
  if v_caller_company is null then
    raise exception '회사 소속이 없습니다';
  end if;

  select company_id, user_id into v_emp_company, v_emp_user from employees where id = p_employee_id;
  if v_emp_company is null then
    raise exception '구성원을 찾을 수 없습니다';
  end if;
  if v_emp_company <> v_caller_company then
    raise exception '다른 회사의 구성원은 처리할 수 없습니다';
  end if;

  v_authorized := public.is_company_master() or coalesce(public.has_perm('/employees:permissions'), false);
  if not v_authorized then
    raise exception '접근 회수 권한이 없습니다 (마스터 또는 권한관리 권한 필요)';
  end if;

  if v_emp_user is not null then
    select coalesce(is_master, false) into v_target_master from users where id = v_emp_user;
    if coalesce(v_target_master, false) then
      raise exception '마스터 계정은 접근을 회수할 수 없습니다';
    end if;
    update users set company_id = null
      where id = v_emp_user and coalesce(is_master, false) = false and company_id = v_emp_company;
    get diagnostics v_count = row_count;
  end if;

  return json_build_object('ok', true, 'user_id', v_emp_user, 'revoked', v_count);
end;
$$;

revoke all on function public.revoke_member_access(uuid) from public, anon;
grant execute on function public.revoke_member_access(uuid) to authenticated;
