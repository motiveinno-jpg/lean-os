-- 결재 요청 댓글 (2026-07-10 사장님 QA — "승인하고 댓글남기기도 할 수 있게")
--   승인/반려 시점 코멘트(approval_steps.comment)와 별개로, 결정 후에도 누구든(회사 구성원)
--   요청 활동 타임라인에서 대화형 댓글을 남길 수 있는 스레드.
create table if not exists public.approval_comments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  user_id uuid not null,
  body text not null,
  created_at timestamptz default now()
);

alter table public.approval_comments enable row level security;

-- RLS: 재귀 게이트 준수 — users/employees 인라인 서브쿼리 금지, SECURITY DEFINER 헬퍼만.
drop policy if exists approval_comments_select on public.approval_comments;
create policy approval_comments_select on public.approval_comments
  for select using (company_id = public.get_my_company_id());
drop policy if exists approval_comments_insert on public.approval_comments;
create policy approval_comments_insert on public.approval_comments
  for insert with check (company_id = public.get_my_company_id() and user_id = auth.uid());
drop policy if exists approval_comments_delete on public.approval_comments;
create policy approval_comments_delete on public.approval_comments
  for delete using (user_id = auth.uid());

create index if not exists idx_approval_comments_request on public.approval_comments(request_id, created_at);
