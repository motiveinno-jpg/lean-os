begin;
--   '본인 급여·계약 정보 변경 금지' 트리거가 서버 작업까지 막고 있었다.
--   초대 수락(/api/invite-accept)은 서비스 롤로 구성원 행을 invited → joined·user_id 로 바꾸는데,
--   서비스 롤엔 로그인 사용자가 없어 is_company_admin()·has_perm() 이 모두 거짓 → 42501(HTTP 403).
--   그래서 초대를 수락하면 계정만 회사로 옮겨지고 명단은 '초대중'으로 남았다.
--   이 트리거가 막으려는 대상은 로그인한 직원 본인이다 — 로그인 사용자가 없는 서버·크론 작업은 통과시킨다.
create or replace function public.enforce_employee_self_no_money_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    return new;
  end if;
  if public.is_company_admin() or public.has_perm('/employees:employees') or public.has_perm('/employees:salary') then
    return new;
  end if;
  if new.salary is distinct from old.salary
     or new.non_taxable_amount is distinct from old.non_taxable_amount
     or new.retirement_accrual is distinct from old.retirement_accrual
     or new.employment_type is distinct from old.employment_type
     or new.hire_date is distinct from old.hire_date
     or new.resignation_date is distinct from old.resignation_date
     or new.status is distinct from old.status
     or new.employee_number is distinct from old.employee_number
     or new.user_id is distinct from old.user_id then
    raise exception '급여·계약 정보는 본인이 바꿀 수 없습니다. 인사 담당자에게 요청하세요.' using errcode = '42501';
  end if;
  return new;
end $function$;
commit;
