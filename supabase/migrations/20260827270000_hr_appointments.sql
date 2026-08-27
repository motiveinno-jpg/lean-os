-- 발령 이력 (2026-08-27 인사 3차 G2, 결정 98) — 부서·직책·급여 변경의 **유일한 출처**. employees 의 department/position/salary 는 캐시.
--   kind: hire 입사 · probation_end 수습종료 · transfer 부서이동 · promotion 승진/직책 · salary 급여변경 · leave_of_absence 휴직 · return 복직 · resign 퇴사 · other
create table if not exists public.hr_appointments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  kind text not null check (kind in ('hire','probation_end','transfer','promotion','salary','leave_of_absence','return','resign','other')),
  effective_date date not null,
  department text,
  position text,
  salary numeric,                 -- 월급(원). salary 종류일 때
  reason text,
  source text not null default 'manual',   -- manual · legacy(옛 employment_history 이관) · salary_history(급여 이력 동기화) · contract(연봉계약)
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists hr_appointments_emp_idx on public.hr_appointments(company_id, employee_id, effective_date desc);
alter table public.hr_appointments enable row level security;
drop policy if exists company_isolation on public.hr_appointments;
create policy company_isolation on public.hr_appointments for all using (company_id = (select public.get_my_company_id()));
drop policy if exists advisor_ro_ins on public.hr_appointments;
create policy advisor_ro_ins on public.hr_appointments for insert to authenticated with check (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_upd on public.hr_appointments;
create policy advisor_ro_upd on public.hr_appointments for update to authenticated using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_del on public.hr_appointments;
create policy advisor_ro_del on public.hr_appointments for delete to authenticated using (not (select public.is_advisor_session()));

--   급여 이력(salary_history: 연봉계약 체결·급여 조정)이 쌓이면 발령 행도 같이 — 데이터를 만드는 자동화라 feature_rollout 게이트(모티브 먼저).
create or replace function public._trg_salary_history_to_appointment() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.feature_on('hr_appointments_sync', new.company_id) then return new; end if;
  insert into public.hr_appointments (company_id, employee_id, kind, effective_date, salary, reason, source, created_by)
  values (new.company_id, new.employee_id, 'salary', new.effective_date, new.salary, coalesce(new.change_reason, '급여 변경'), 'salary_history', new.approved_by);
  return new;
end $$;
drop trigger if exists trg_salary_history_to_appointment on public.salary_history;
create trigger trg_salary_history_to_appointment after insert on public.salary_history for each row execute function public._trg_salary_history_to_appointment();
insert into public.feature_rollout (feature, company_id) values ('hr_appointments_sync', 'c361afb9-8a52-4cac-add9-8992f0f7c09c') on conflict do nothing;
