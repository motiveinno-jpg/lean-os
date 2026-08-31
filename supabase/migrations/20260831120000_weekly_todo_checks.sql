-- 경영 요약 '이번 주 챙길 것' 체크를 서버로 (2026-08-31 낡은정보 스윕).
--   종전엔 localStorage(사용자·PC별)라 다른 기기에서 다시 나타나고, 미해결인데 숨겨진 채
--   기기에 갇혔다. 회사 단위 DB 저장으로 어디서 봐도 같은 상태.
--   week_key = 그 주 월요일(YYYY-MM-DD) — 주가 바뀌면 새 키라 자동으로 다시 뜬다(주간 리셋 의도 유지).
create table if not exists public.weekly_todo_checks (
  company_id uuid not null references public.companies(id) on delete cascade,
  week_key date not null,
  todo_key text not null,
  checked_by uuid references public.users(id) on delete set null,
  checked_at timestamptz not null default now(),
  primary key (company_id, week_key, todo_key)
);

alter table public.weekly_todo_checks enable row level security;

drop policy if exists weekly_todo_checks_company on public.weekly_todo_checks;
create policy weekly_todo_checks_company on public.weekly_todo_checks
  for all
  using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());
