-- 보안 점검(2026-09-09) S08: 공개 버킷(company-assets)에 섞여 있던 회사 직인을 비공개 버킷으로 분리한다.
--   company-assets 는 로고·아바타처럼 공개돼도 되는 것만 남긴다. 직인은 주소를 아는 누구나 내려받을 수 있었다.
--   새 버킷 company-private: 회사 폴더({companyId}/...)만 읽고 쓰며, 세무사 세션의 쓰기·삭제는 전역 RESTRICTIVE 정책이 막는다.
--   기존 직인 파일의 이동과 companies.seal_url 갱신은 scripts/security-move-seals.mjs 로(서비스 키 필요).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-private', 'company-private', false, 10485760, array['image/png','image/jpeg','image/webp','application/pdf'])
on conflict (id) do update set public = false;

drop policy if exists company_private_select on storage.objects;
create policy company_private_select on storage.objects for select to authenticated
  using (bucket_id = 'company-private' and (storage.foldername(name))[1] = (select public.get_my_company_id())::text);
drop policy if exists company_private_insert on storage.objects;
create policy company_private_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'company-private' and (storage.foldername(name))[1] = (select public.get_my_company_id())::text);
drop policy if exists company_private_update on storage.objects;
create policy company_private_update on storage.objects for update to authenticated
  using (bucket_id = 'company-private' and (storage.foldername(name))[1] = (select public.get_my_company_id())::text);
drop policy if exists company_private_delete on storage.objects;
create policy company_private_delete on storage.objects for delete to authenticated
  using (bucket_id = 'company-private' and (storage.foldername(name))[1] = (select public.get_my_company_id())::text
         and ((select public.is_company_admin()) or owner_id = (select auth.uid())::text));
