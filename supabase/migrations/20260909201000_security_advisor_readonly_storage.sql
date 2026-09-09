-- 보안 점검(2026-09-09) S06: 읽기 전용 세무사·삭제 범위.
--   get_my_company_id() 는 세무사가 고른 회사도 돌려주므로 "회사 경로 일치"만 보는 Storage 정책과
--   체크 표(tax_deadline_checks·weekly_todo_checks)에서 읽기 전용 세무사가 쓰기·삭제에 들어올 수 있었다.
--   ① Storage 객체의 INSERT/UPDATE/DELETE 에 세무사 세션 차단(RESTRICTIVE — 기존 정책과 AND 로 겹친다).
--   ② 두 체크 표에도 같은 차단. ③ 직원 파일(employee-files) 삭제는 관리자·구성원 권한·올린 사람만.

-- ① Storage: 세무사 세션은 쓰지도 지우지도 못한다
drop policy if exists advisor_ro_storage_ins on storage.objects;
create policy advisor_ro_storage_ins on storage.objects as restrictive for insert to authenticated
  with check (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_storage_upd on storage.objects;
create policy advisor_ro_storage_upd on storage.objects as restrictive for update to authenticated
  using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_storage_del on storage.objects;
create policy advisor_ro_storage_del on storage.objects as restrictive for delete to authenticated
  using (not (select public.is_advisor_session()));

-- ② 체크 표
drop policy if exists advisor_ro_ins on public.tax_deadline_checks;
create policy advisor_ro_ins on public.tax_deadline_checks as restrictive for insert with check (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_upd on public.tax_deadline_checks;
create policy advisor_ro_upd on public.tax_deadline_checks as restrictive for update using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_del on public.tax_deadline_checks;
create policy advisor_ro_del on public.tax_deadline_checks as restrictive for delete using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_ins on public.weekly_todo_checks;
create policy advisor_ro_ins on public.weekly_todo_checks as restrictive for insert with check (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_upd on public.weekly_todo_checks;
create policy advisor_ro_upd on public.weekly_todo_checks as restrictive for update using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_del on public.weekly_todo_checks;
create policy advisor_ro_del on public.weekly_todo_checks as restrictive for delete using (not (select public.is_advisor_session()));

-- ③ 직원 파일 삭제: 같은 회사이면서 (관리자 · 구성원 관리 권한 · 올린 본인)
drop policy if exists employee_files_storage_delete on storage.objects;
create policy employee_files_storage_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'employee-files'
    and (storage.foldername(name))[1] = (select public.get_my_company_id())::text
    and (
      (select public.is_company_admin())
      or (select public.has_perm('/employees'))
      or (select public.has_perm('/employees:all'))
      or owner_id = (select auth.uid())::text
    )
  );
