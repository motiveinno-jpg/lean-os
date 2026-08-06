-- 공지사항 작성·수정·삭제를 서비스 운영자 전용으로 (2026-08-06 사장님 지시).
--   기존: 회사 관리자(is_company_admin 또는 has_perm('/announcements:manage'))도 자기 회사 공지를 쓸 수 있었다.
--   변경: 모든 오너뷰 사용자는 열람만. 쓰기는 is_platform_operator() 만 — 운영자 페이지(/platform/announcements)에서 한다.
--   SELECT 는 그대로(전체공지 + 자기 회사 공지)이되, 운영자는 레거시 회사별 공지도 관리해야 하므로 조건 추가.

drop policy if exists announcements_insert_admin on public.announcements;
drop policy if exists announcements_update_admin on public.announcements;
drop policy if exists announcements_delete_admin on public.announcements;

create policy announcements_insert_operator on public.announcements
  for insert to authenticated
  with check ((select is_platform_operator()));

create policy announcements_update_operator on public.announcements
  for update to authenticated
  using ((select is_platform_operator()))
  with check ((select is_platform_operator()));

create policy announcements_delete_operator on public.announcements
  for delete to authenticated
  using ((select is_platform_operator()));

drop policy if exists announcements_select_company on public.announcements;
create policy announcements_select_company on public.announcements
  for select to authenticated
  using (
    company_id is null
    or company_id = (select get_my_company_id())
    or (select is_platform_operator())
  );
