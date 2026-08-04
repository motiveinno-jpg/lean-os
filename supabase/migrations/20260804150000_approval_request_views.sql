-- 결재 요청 "확인(열람) 표시" 개인 기록 (2026-08-04 사장님 지시)
--   결재허브 > 전체 현황에서 한 번 열어 본 건의 제목을 연하게 표시한다.
--   어제 localStorage 로 출시한 것을 계정 기준으로 전환 — 브라우저·PC 가 바뀌어도 따라오게.
--   개인 기록이므로 회사 격리가 아니라 "본인 행만" 정책. 프론트는 ignoreDuplicates upsert
--   (= ON CONFLICT DO NOTHING) 만 쓰므로 UPDATE 정책은 만들지 않는다
--   (DO UPDATE 경로는 INSERT 에도 SELECT 정책이 걸리는 함정 — 20260730 교훈).
create table if not exists public.approval_request_views (
  user_id uuid not null references public.users(id) on delete cascade,
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (user_id, request_id)
);

comment on table public.approval_request_views is
  '결재 요청 열람 기록(개인). PK(user_id, request_id) 로 사용자별 조회를 커버 — 별도 인덱스 불필요.';

alter table public.approval_request_views enable row level security;

-- 본인 행만 조회
drop policy if exists approval_request_views_select_self on public.approval_request_views;
create policy approval_request_views_select_self on public.approval_request_views
  for select using (user_id = (select public.current_app_user_id()));

-- 본인 행만 기록
drop policy if exists approval_request_views_insert_self on public.approval_request_views;
create policy approval_request_views_insert_self on public.approval_request_views
  for insert with check (user_id = (select public.current_app_user_id()));

-- 본인 기록 정리
drop policy if exists approval_request_views_delete_self on public.approval_request_views;
create policy approval_request_views_delete_self on public.approval_request_views
  for delete using (user_id = (select public.current_app_user_id()));

-- UPDATE 정책 없음(의도) — 기본 deny.

-- 신규 테이블 기본 grant 누락 함정 방지 — 명시 부여.
grant select, insert, delete on public.approval_request_views to authenticated;
