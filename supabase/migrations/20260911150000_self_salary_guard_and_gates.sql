-- 설정 전수 점검 7차 — 남은 권한 구멍 (2026-09-11).
begin;

-- ① 직원이 자기 인사기록의 급여를 스스로 고치던 것.
--    본인 행 수정은 마이페이지가 있으니 맞다. 문제는 그 행에 급여가 같이 있고 막는 장치가 없던 것이다.
--    관리자·인사 권한자가 아니면 돈과 신분에 관한 칸은 바꾸지 못하게 한다.
create or replace function public.enforce_employee_self_no_money_change()
returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
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
end $$;
drop trigger if exists employees_self_no_money_change on public.employees;
create trigger employees_self_no_money_change
  before update on public.employees
  for each row execute function public.enforce_employee_self_no_money_change();

-- ② 4대보험 요율 — 전 직원 급여 산식이다. 자금·통장 권한만으로 바꾸던 것을 인사·회계 쪽으로 좁힌다.
--    (화면 노출 키는 settings-nav 가 따로 정한다 — 여기서는 DB 를 막는다.)
drop policy if exists company_isolation on public.company_insurance_rates;
create policy company_insurance_rates_read on public.company_insurance_rates for select to authenticated
  using (company_id = (select public.get_my_company_id()));
create policy company_insurance_rates_write on public.company_insurance_rates for all to authenticated
  using (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/settings:insurance'))
              or (select public.has_perm('/settings:closing')) or (select public.has_perm('/employees:salary'))))
  with check (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/settings:insurance'))
              or (select public.has_perm('/settings:closing')) or (select public.has_perm('/employees:salary'))));

-- ③ 세무사 연락처·열람 이력을 아무 구성원이나 조회하던 것. 세무 파트너 설정을 볼 수 있는 사람만.
create or replace function public.company_my_advisors()
returns table(link_id uuid, advisor_id uuid, name text, office_name text, specialty text, email text, phone text, linked_at timestamp with time zone)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_company uuid := get_my_company_id();
begin
  if v_company is null then raise exception 'forbidden'; end if;
  --   2026-09-11 추가: 연결된 세무사의 이름·이메일·전화는 회사 전원이 볼 것이 아니다.
  --   되돌리는 칸(반환 열)은 그대로 두고 검사만 앞에 넣는다.
  if not (public.is_company_admin() or public.is_company_manager()
          or public.has_perm('/settings:tax-partner') or public.has_perm('/settings:company-info')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select l.id, a.id, a.name, a.office_name, a.specialty, a.email, a.phone, l.created_at
  from advisor_company_links l join tax_advisors a on a.id = l.advisor_id
  where l.company_id = v_company and l.status = 'active' and a.status = 'active'
  order by l.created_at;
end $$;

commit;
