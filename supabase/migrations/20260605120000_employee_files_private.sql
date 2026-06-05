-- employee-files 보안 — 직원 주민등록등본 등 PII 가 public 버킷으로 익명 노출되던 문제.
-- SELECT 를 authenticated + 회사격리(anon 차단, select-wrap 으로 initplan 최적화) + 버킷 private 전환.
-- 표시는 클라이언트 signed URL(authenticated 가 자사 파일만 서명). 되돌리려면 public=true.
drop policy if exists employee_files_storage_select on storage.objects;
create policy employee_files_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'employee-files' and (storage.foldername(name))[1] = (select get_my_company_id())::text);
update storage.buckets set public = false where id = 'employee-files';
