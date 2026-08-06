-- 공지 읽음 기록 — 사이드바 "공지사항" 배지용 (2026-08-06 사장님 지시).
--   기기별 localStorage 가 아니라 계정별 DB 저장(결재 확인 표시를 계정별로 바꾼 것과 동일 기조).
create table if not exists public.announcement_reads (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

create index if not exists announcement_reads_user_idx on public.announcement_reads(user_id);

alter table public.announcement_reads enable row level security;

drop policy if exists announcement_reads_select_own on public.announcement_reads;
create policy announcement_reads_select_own on public.announcement_reads
  for select to authenticated
  using (user_id = (select current_app_user_id()));

drop policy if exists announcement_reads_insert_own on public.announcement_reads;
create policy announcement_reads_insert_own on public.announcement_reads
  for insert to authenticated
  with check (user_id = (select current_app_user_id()));

drop policy if exists announcement_reads_delete_own on public.announcement_reads;
create policy announcement_reads_delete_own on public.announcement_reads
  for delete to authenticated
  using (user_id = (select current_app_user_id()));

-- 안 읽은 공지 수 — security invoker 라 announcements 의 SELECT 정책(내가 볼 수 있는 공지)이 그대로 적용된다.
create or replace function public.unread_announcement_count()
returns integer
language sql
stable
security invoker
set search_path to 'public'
as $$
  select count(*)::int
  from public.announcements a
  where not exists (
    select 1 from public.announcement_reads r
    where r.announcement_id = a.id
      and r.user_id = (select current_app_user_id())
  );
$$;

grant execute on function public.unread_announcement_count() to authenticated;
