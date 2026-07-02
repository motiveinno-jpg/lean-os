-- 실행형 태스크 댓글 — 설명에 대한 답글 스레드 (2026-07-02)
--   parent_id 자기참조로 답글의 답글 무한 중첩. 부모 삭제 시 하위 답글 cascade.

create table if not exists public.task_comments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  task_id     uuid not null references public.project_tasks(id) on delete cascade,
  parent_id   uuid references public.task_comments(id) on delete cascade,
  body        text not null,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists task_comments_task_idx on public.task_comments(task_id);

alter table public.task_comments enable row level security;
drop policy if exists task_comments_company on public.task_comments;
create policy task_comments_company on public.task_comments
  for all using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());
