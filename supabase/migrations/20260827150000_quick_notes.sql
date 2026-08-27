-- 상단바 메모(note) — 사용자 개인 메모, 두 PC 어디서든 같은 것 (2026-08-27 사장님: "상단바 알림 왼쪽에 계산기·화면캡쳐·메모 아이콘")
--   localStorage 가 아니라 표인 이유: 사장님이 PC 2대를 쓴다 — 기기에 갇힌 메모는 메모가 아니다.
create table if not exists public.quick_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  body text not null default '',
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quick_notes_user_idx on public.quick_notes(user_id, pinned, updated_at desc);
alter table public.quick_notes enable row level security;
drop policy if exists own_notes on public.quick_notes;
create policy own_notes on public.quick_notes for all
  using (user_id = (select u.id from public.users u where u.auth_id = auth.uid() limit 1))
  with check (user_id = (select u.id from public.users u where u.auth_id = auth.uid() limit 1) and company_id = (select public.get_my_company_id()));
