-- 은행연동 인증정보·공동인증서도 역할이 아니라 권한으로 (2026-09-11 사장님).
--   설정 화면은 /settings:bank 하나로 은행연동 탭을 열어 주는데, DB 는 users.role in (owner,admin) 이라
--   위임받은 사람이 폼을 다 채우고 인증서까지 올린 뒤 비밀번호 저장에서 실패했다. 연결 상태 조회도 빈 값이라
--   이미 연결돼 있어도 '미연결'로 보였다(전수 점검에서 잡힌 은행연동 H1).
--   기준을 '마스터 또는 은행연동 권한자'로 맞춘다.
begin;

do $$
declare r record;
begin
  for r in select polname, polcmd from pg_policy where polrelid = 'public.automation_credentials'::regclass
  loop
    execute format('drop policy if exists %I on public.automation_credentials', r.polname);
  end loop;
end $$;

create policy automation_credentials_read on public.automation_credentials for select to authenticated
  using (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/settings:bank'))));
create policy automation_credentials_write on public.automation_credentials for all to authenticated
  using (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/settings:bank'))))
  with check (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/settings:bank'))));

--   공동인증서 보관함도 같은 기준. 폴더 첫 칸이 회사 id 인 구조는 그대로 둔다.
drop policy if exists cert_select on storage.objects;
create policy cert_select on storage.objects for select
  using (bucket_id = 'certificates'
         and (storage.foldername(name))[1] = ((select public.get_my_company_id()))::text
         and ((select public.is_company_manager()) or (select public.has_perm('/settings:bank'))));
drop policy if exists cert_insert on storage.objects;
create policy cert_insert on storage.objects for insert
  with check (bucket_id = 'certificates'
         and (storage.foldername(name))[1] = ((select public.get_my_company_id()))::text
         and ((select public.is_company_manager()) or (select public.has_perm('/settings:bank'))));
drop policy if exists cert_update on storage.objects;
create policy cert_update on storage.objects for update
  using (bucket_id = 'certificates'
         and (storage.foldername(name))[1] = ((select public.get_my_company_id()))::text
         and ((select public.is_company_manager()) or (select public.has_perm('/settings:bank'))));
drop policy if exists cert_delete on storage.objects;
create policy cert_delete on storage.objects for delete
  using (bucket_id = 'certificates'
         and (storage.foldername(name))[1] = ((select public.get_my_company_id()))::text
         and ((select public.is_company_manager()) or (select public.has_perm('/settings:bank'))));

commit;
