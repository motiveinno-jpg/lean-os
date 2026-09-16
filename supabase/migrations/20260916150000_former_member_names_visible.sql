-- 퇴사자 이름이 구성원에게 '-' 로 보이던 문제.
--
--   퇴사 처리(20260916140000)가 users 행을 '묘비'로 남기며 company_id 를 비운다(귀속 이름 보존이 목적).
--   그런데 users 의 SELECT 정책이 "company_id = 내 회사" 뿐이라, 회사 소속이 끊긴 묘비 행은 일반 구성원이
--   읽을 수 없다 — 결재·게시글·파일에 붙은 이름 조인이 전부 비어 '-' 가 됐다(운영자 계정만 이름이 보였다).
--
--   해결: 묘비 행에 '어느 회사의 전 구성원이었나'(former_company_id)를 남기고, 그 회사 구성원은 그 행을 읽게 한다.
--   · 이메일은 이미 치환돼 있고 auth 링크도 없어 노출되는 건 이름(과 아바타)뿐 — 회사 안에서 원래 보던 정보다.
--   · 회사 구성원 목록(company_id = 내 회사)에는 여전히 안 나온다 — 조인으로 이름을 찾을 때만 읽힌다.

alter table public.users add column if not exists former_company_id uuid references public.companies(id) on delete set null;
create index if not exists users_former_company_idx on public.users (former_company_id) where former_company_id is not null;

-- 기존 묘비 백필 — 직원 행(employees.user_id)이 어느 회사인지로 되찾는다.
update public.users u
   set former_company_id = e.company_id
  from public.employees e
 where u.company_id is null and u.former_company_id is null and e.user_id = u.id;

drop policy if exists users_select_former_member on public.users;
create policy users_select_former_member on public.users
  for select to authenticated
  using (company_id is null and former_company_id = (select public.get_my_company_id()));

-- 퇴사 처리 함수 — 묘비화할 때 former_company_id 를 같이 남긴다. 나머지 본문은 20260916140000 그대로.
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
  if v_emp_user is null then
    return json_build_object('ok', true, 'account', false);
  end if;
  select coalesce(is_master, false), auth_id into v_target_master, v_auth_id from users where id = v_emp_user;
  if coalesce(v_target_master, false) then raise exception '마스터 계정은 퇴사 처리로 삭제할 수 없습니다'; end if;
  -- 1) public.users 묘비화 — 회사 접근 끊기 + 이메일 해제. 이름과 '전 소속 회사'는 남겨 회사 안 귀속 표시에 쓴다.
  update users
     set former_company_id = coalesce(former_company_id, company_id),
         company_id = null,
         auth_id = null,
         email = 'former+' || v_emp_user::text || '@removed.invalid'
   where id = v_emp_user and coalesce(is_master, false) = false;
  -- 2) auth 계정 삭제 — 로그인 차단 + 원래 이메일 재사용 가능.
  if v_auth_id is not null then
    delete from auth.users where id = v_auth_id;
    get diagnostics v_deleted_auth = row_count;
  end if;
  if v_deleted_auth = 0 then
    delete from auth.users where id = v_emp_user;
    get diagnostics v_deleted_auth = row_count;
  end if;
  return json_build_object('ok', true, 'account', true, 'auth_deleted', v_deleted_auth);
end;
$$;
revoke all on function public.offboard_member(uuid) from public, anon;
grant execute on function public.offboard_member(uuid) to authenticated;
