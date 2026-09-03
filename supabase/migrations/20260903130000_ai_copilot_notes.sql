-- AI 참모 "회사 메모" (2026-09-03 사장님: 참모를 학습시켜 쓸만하게)
--   Claude 를 재훈련하는 대신, 회사별로 대표·관리자가 알려준 사실·선호·교정을 저장해
--   참모가 답할 때마다 함께 읽게 한다. 다른 회사에는 절대 새지 않도록 company_id 스코프 + RLS.
create table if not exists public.ai_copilot_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 500),
  -- fact: 회사 사실("급여는 매달 25일") · preference: 답변 방식("숫자는 표로") · correction: 틀린 답 교정
  kind text not null default 'fact' check (kind in ('fact','preference','correction')),
  -- user: 메모 화면에서 직접 · feedback: 답변 아래 "바로잡기" · copilot: 대화 중 "기억해"
  source text not null default 'user' check (source in ('user','feedback','copilot')),
  question text,                       -- correction 일 때 원래 질문(맥락)
  created_by uuid references public.users(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_copilot_notes_company_active_idx on public.ai_copilot_notes (company_id, created_at) where active;

alter table public.ai_copilot_notes enable row level security;

-- 참모를 쓸 수 있는 구성원(관리자 또는 /copilot 권한)만 읽고 쓴다. 세무사 열람 세션은 읽기 전용.
drop policy if exists ai_copilot_notes_select on public.ai_copilot_notes;
create policy ai_copilot_notes_select on public.ai_copilot_notes for select to authenticated
  using (company_id = (select get_my_company_id()) and (is_company_admin() or has_perm('/copilot')));
drop policy if exists ai_copilot_notes_insert on public.ai_copilot_notes;
create policy ai_copilot_notes_insert on public.ai_copilot_notes for insert to authenticated
  with check (company_id = (select get_my_company_id()) and (is_company_admin() or has_perm('/copilot')) and not (select is_advisor_session()));
drop policy if exists ai_copilot_notes_update on public.ai_copilot_notes;
create policy ai_copilot_notes_update on public.ai_copilot_notes for update to authenticated
  using (company_id = (select get_my_company_id()) and (is_company_admin() or has_perm('/copilot')) and not (select is_advisor_session()));
drop policy if exists ai_copilot_notes_delete on public.ai_copilot_notes;
create policy ai_copilot_notes_delete on public.ai_copilot_notes for delete to authenticated
  using (company_id = (select get_my_company_id()) and (is_company_admin() or has_perm('/copilot')) and not (select is_advisor_session()));

comment on table public.ai_copilot_notes is 'AI 참모 회사 메모 — 대표·관리자가 알려준 사실·선호·교정. 참모가 답변마다 읽는다(회사별 격리).';
