-- API 키 화면·확인 API와 DB 쓰기 권한을 현행 마스터/위임 권한으로 맞춘다.
begin;
drop policy if exists company_api_keys_read on public.company_api_keys;
drop policy if exists company_api_keys_write on public.company_api_keys;
create policy company_api_keys_read on public.company_api_keys for select to authenticated
using (
  company_id = (select public.get_my_company_id())
  and not (select public.is_advisor_session())
  and ((select public.is_company_admin()) or (select public.has_perm('/settings:api-keys')) or (select public.has_perm('/settings:ads')))
);
create policy company_api_keys_write on public.company_api_keys for all to authenticated
using (
  company_id = (select public.get_my_company_id())
  and not (select public.is_advisor_session())
  and ((select public.is_company_admin()) or (select public.has_perm('/settings:api-keys')) or (select public.has_perm('/settings:ads')))
)
with check (
  company_id = (select public.get_my_company_id())
  and not (select public.is_advisor_session())
  and ((select public.is_company_admin()) or (select public.has_perm('/settings:api-keys')) or (select public.has_perm('/settings:ads')))
);
commit;
