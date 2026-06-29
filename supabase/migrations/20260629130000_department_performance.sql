-- 부서별 성과 — 부서 마스터 테이블 + 실적입력 부서 귀속 (2026-06-29)
--   (1) 실적 입력행마다 부서(project_kpi_entries.department_id)
--   (2) 노출 = 프로젝트 개요 콕핏 + 관리자 성과 대시보드
--   (3) 부서 목록 = 신규 마스터 테이블(departments) + 회사설정 관리
--   회귀 안전: department_id 는 nullable, 기존 entries/대시보드 동작 불변.

-- 1) 부서 마스터
create table if not exists public.departments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  sort_order  int  not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists uq_departments_company_name
  on public.departments (company_id, name) where archived_at is null;
create index if not exists idx_departments_company on public.departments (company_id);

alter table public.departments enable row level security;
drop policy if exists departments_company on public.departments;
create policy departments_company on public.departments
  for all using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());

-- 2) 기존 employees.department(자유 텍스트) → 마스터 seed (중복 방지)
insert into public.departments (company_id, name)
select distinct e.company_id, btrim(e.department)
from public.employees e
where e.department is not null and btrim(e.department) <> ''
  and not exists (
    select 1 from public.departments d
    where d.company_id = e.company_id and d.name = btrim(e.department)
  );

-- 3) 실적 입력행에 부서 귀속 (nullable — 기존 행은 NULL=미지정)
alter table public.project_kpi_entries
  add column if not exists department_id uuid references public.departments(id) on delete set null;
create index if not exists idx_project_kpi_entries_dept
  on public.project_kpi_entries (department_id);
