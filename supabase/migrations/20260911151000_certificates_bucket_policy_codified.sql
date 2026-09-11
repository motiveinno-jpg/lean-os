-- 공동인증서 보관함(certificates) 접근 규칙을 저장소에 남긴다 (2026-09-11).
--   제품에서 가장 민감한 파일(공동인증서 개인키)이 든 버킷인데, 정책이 대시보드에서 손으로 만들어져
--   마이그레이션에 없었다. 상태를 코드로 확인할 수 없고 재배포·복구 때 재현되지 않는다.
--   운영에 걸려 있는 것과 **같은 내용**을 그대로 적어 둔다(대표·관리자 + 자기 회사 폴더만).
--   지금 확인한 실제 정책: bucket_id='certificates' and foldername[1] in (내 회사 id where role in owner/admin)
begin;

drop policy if exists cert_select on storage.objects;
create policy cert_select on storage.objects for select
  using (bucket_id = 'certificates'
         and (storage.foldername(name))[1] in (
           select (u.company_id)::text from public.users u
            where u.auth_id = auth.uid() and u.role = any (array['owner', 'admin'])));

drop policy if exists cert_insert on storage.objects;
create policy cert_insert on storage.objects for insert
  with check (bucket_id = 'certificates'
         and (storage.foldername(name))[1] in (
           select (u.company_id)::text from public.users u
            where u.auth_id = auth.uid() and u.role = any (array['owner', 'admin'])));

drop policy if exists cert_update on storage.objects;
create policy cert_update on storage.objects for update
  using (bucket_id = 'certificates'
         and (storage.foldername(name))[1] in (
           select (u.company_id)::text from public.users u
            where u.auth_id = auth.uid() and u.role = any (array['owner', 'admin'])));

drop policy if exists cert_delete on storage.objects;
create policy cert_delete on storage.objects for delete
  using (bucket_id = 'certificates'
         and (storage.foldername(name))[1] in (
           select (u.company_id)::text from public.users u
            where u.auth_id = auth.uid() and u.role = any (array['owner', 'admin'])));

commit;
