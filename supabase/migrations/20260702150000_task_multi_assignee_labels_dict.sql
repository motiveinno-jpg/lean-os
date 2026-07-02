-- 실행형 태스크: 다중 담당자 + 회사 공용 라벨 사전 (2026-07-02)
--   assignee_ids jsonb = ["user_id", ...] (기존 assignee_id 는 첫 담당자로 유지 — 하위호환)
--   task_labels = 회사 공용 라벨 사전. 태스크의 labels jsonb 에는 {text,color} 스냅샷 저장(사전 삭제와 무관하게 유지).

alter table public.project_tasks
  add column if not exists assignee_ids jsonb not null default '[]'::jsonb;

create table if not exists public.task_labels (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  color       text not null default '#0ea5e9',
  created_at  timestamptz not null default now(),
  unique (company_id, name)
);

alter table public.task_labels enable row level security;
drop policy if exists task_labels_company on public.task_labels;
create policy task_labels_company on public.task_labels
  for all using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());
