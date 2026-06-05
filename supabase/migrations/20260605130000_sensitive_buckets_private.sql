-- 민감 버킷 4종 private 전환 (현재 파일 0개라 비파괴). 직원파일과 동일 패턴.
-- anon SELECT 차단(authenticated 만), 가능한 버킷은 회사격리. 표시는 signed URL(FE).
-- company-assets/board-files/chat-files 는 외부embed·저장URL 때문에 public 유지.
drop policy if exists document_files_select on storage.objects;
create policy document_files_select on storage.objects for select to authenticated
  using (bucket_id = 'document-files');
drop policy if exists documents_storage_select on storage.objects;
drop policy if exists documents_bucket_select on storage.objects;
create policy documents_select on storage.objects for select to authenticated
  using (bucket_id = 'documents');
drop policy if exists deal_files_read on storage.objects;
create policy deal_files_read on storage.objects for select to authenticated
  using (bucket_id = 'deal-files' and (storage.foldername(name))[1] = (select get_my_company_id())::text);
drop policy if exists receipts_storage_select on storage.objects;
drop policy if exists receipts_bucket_select on storage.objects;
create policy receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select get_my_company_id())::text);
update storage.buckets set public = false where id in ('document-files','documents','deal-files','receipts');
