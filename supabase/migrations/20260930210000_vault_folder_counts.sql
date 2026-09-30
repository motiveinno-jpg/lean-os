-- 파일보관함 폴더마다 파일 개수 — 폴더 줄의 "폴더 2개 · 파일 3개" 용.
--   행을 다 받아 세면 1,000행 상한에서 잘린다. 부르는 사람 권한(RLS) 그대로 세므로 안 보이는 파일은 세지 않는다.
begin;

create or replace function public.vault_folder_file_counts(p_company uuid)
returns table (folder_id uuid, files integer)
language sql stable security invoker set search_path to 'public' as $$
  select d.folder_id, count(*)::int
    from public.document_files d
   where d.company_id = p_company and d.folder_id is not null and d.parent_file_id is null
     and d.document_id is null and d.vault_doc_id is null and d.deal_id is null
   group by d.folder_id
$$;
revoke all on function public.vault_folder_file_counts(uuid) from public, anon;
grant execute on function public.vault_folder_file_counts(uuid) to authenticated, service_role;

commit;
