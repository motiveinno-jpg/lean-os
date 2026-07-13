-- 프로젝트 이슈/리스크 트래커 (2026-07-13)
--   deal(프로젝트)별 이슈 목록 — 심각도/상태/담당자/기한/해결기록.
--   회사 격리 RLS는 project_kpis 와 동일 패턴(get_my_company_id) 미러링. 새 헬퍼 함수 없음.
--   updated_at: 다른 project_* 테이블에 자동갱신 트리거 관례 없음 → 앱에서 갱신(트리거 생략).

create table if not exists public.project_issues (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  deal_id      uuid not null references public.deals(id) on delete cascade,
  title        text not null,
  description  text,
  severity     text not null default 'medium' check (severity in ('low','medium','high','critical')),
  status       text not null default 'open'   check (status in ('open','in_progress','resolved')),
  assignee_id  uuid references public.users(id) on delete set null,
  due_date     date,
  resolution   text,
  resolved_at  timestamptz,
  created_by   uuid references public.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_project_issues_deal        on public.project_issues (deal_id);
create index if not exists idx_project_issues_deal_status on public.project_issues (deal_id, status);
create index if not exists idx_project_issues_assignee    on public.project_issues (assignee_id);

alter table public.project_issues enable row level security;
drop policy if exists project_issues_company on public.project_issues;
create policy project_issues_company on public.project_issues
  for all using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());
