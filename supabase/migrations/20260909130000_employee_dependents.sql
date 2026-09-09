-- 급여 소득세 부양가족 수 (2026-09-09) — 종전엔 부양가족 1명(본인) 고정이라
--   부양가족 있는 직원의 간이세액표 소득세가 실제보다 과다하게 명세서에 찍혔다.
--   dependents = 공제대상 가족 수(본인 포함, 국세청 간이세액표 기준). 기본 1.
alter table public.employees
  add column if not exists dependents integer not null default 1;
alter table public.employees
  drop constraint if exists employees_dependents_range;
alter table public.employees
  add constraint employees_dependents_range check (dependents between 1 and 20);
