-- 파일보관함 맨 위(폴더 밖) 파일 다시 허용 — 전체 폴더 화면에서 폴더 아래에 폴더 밖 파일을 보여 준다.
--   20260930200000 의 '파일은 반드시 폴더 안' CHECK 를 뺀다. 폴더 트리 규칙(순환·범위 상속·같은 이름·빈 폴더만 삭제)은 그대로.
--   폴더 밖 파일의 실물 경로는 {company}/general/… 로 회사 전체 공개(스토리지 RLS 종전 규칙).
--   MCP: 올리기 folder_id 선택(없으면 맨 위), 목록에 폴더 밖 파일 포함(folder = null), 파일 옮기기에 맨 위 허용.
begin;

alter table public.document_files drop constraint if exists document_files_vault_needs_folder;

create or replace function public.mcp_vault_files(p_auth uuid, p_company uuid, p_folder uuid default null, p_query text default null, p_limit integer default 100)
returns jsonb language plpgsql security invoker set search_path to 'public' as $$
declare v_q text := nullif(trim(coalesce(p_query, '')), '');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
  if public.get_my_company_id() is distinct from p_company then raise exception 'company mismatch'; end if;
  return (
    with recursive t as (
      select f.id, f.name, f.parent_id, f.name::text as path, 1 as d from public.document_folders f where f.parent_id is null
      union all
      select c.id, c.name, c.parent_id, t.path || ' › ' || c.name, t.d + 1 from public.document_folders c join t on c.parent_id = t.id where t.d < 200
    )
    select jsonb_build_object(
      'folders', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'parent_id', p.parent_id, 'path', p.path) order by p.path)
                             from t p), '[]'::jsonb),
      'files', coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
          select jsonb_build_object('id', d.id, 'name', d.file_name, 'folder', fo.path, 'folder_id', d.folder_id,
                                    'size', d.file_size, 'mime_type', d.mime_type, 'category', d.category, 'tags', d.tags,
                                    'version', d.version, 'created_at', d.created_at) x
            from public.document_files d left join t fo on fo.id = d.folder_id
           where d.parent_file_id is null and d.document_id is null and d.vault_doc_id is null and d.deal_id is null
             and (p_folder is null or d.folder_id = p_folder)
             and (d.folder_id is null or fo.id is not null)   -- 폴더 안 파일은 그 폴더가 보일 때만
             and (v_q is null or d.file_name ilike '%' || v_q || '%' or array_to_string(d.tags, ' ') ilike '%' || v_q || '%'
                  or coalesce(fo.path, '') ilike '%' || v_q || '%')
           order by d.created_at desc
           limit least(greatest(coalesce(p_limit, 100), 1), 300)) s), '[]'::jsonb)
    )
  );
end $$;

create or replace function public.mcp_vault_upload_check(p_auth uuid, p_company uuid, p_folder uuid)
returns jsonb language plpgsql security invoker set search_path to 'public' as $$
declare v_user uuid; s record;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
  if public.get_my_company_id() is distinct from p_company then raise exception 'company mismatch'; end if;
  select id into v_user from public.users where auth_id = p_auth;
  if p_folder is not null and not exists (select 1 from public.document_folders where id = p_folder) then
    return jsonb_build_object('ok', false, 'error', '폴더가 없거나 볼 권한이 없습니다.');
  end if;
  select * into s from public.get_company_storage(p_company) limit 1;
  return jsonb_build_object('ok', true, 'user_id', v_user,
    'used_bytes', coalesce(s.used_bytes, 0), 'quota_bytes', coalesce(s.quota_bytes, 0));
end $$;

create or replace function public.mcp_vault_file_move_plan(p_auth uuid, p_company uuid, p_file uuid, p_folder uuid)
returns jsonb language plpgsql security invoker set search_path to 'public' as $$
declare f record; v_to text;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
  if public.get_my_company_id() is distinct from p_company then raise exception 'company mismatch'; end if;
  select id, file_name, folder_id, uploaded_by into f from public.document_files
   where id = p_file and parent_file_id is null and document_id is null and vault_doc_id is null and deal_id is null;
  if f.id is null then return jsonb_build_object('error', '파일이 없거나 볼 권한이 없습니다.'); end if;
  if p_folder is null then v_to := '폴더 밖(맨 위)';
  else
    select name into v_to from public.document_folders where id = p_folder;
    if v_to is null then return jsonb_build_object('error', '옮길 폴더가 없거나 볼 권한이 없습니다.'); end if;
  end if;
  if f.folder_id is not distinct from p_folder then return jsonb_build_object('name', f.file_name, 'same', true); end if;
  if not (f.uploaded_by = (select public.current_app_user_id()) or (select public.has_perm('/documents:delete'))) then
    return jsonb_build_object('error', '본인이 올린 파일만 옮길 수 있습니다. 다른 사람의 파일은 마스터 또는 파일 삭제 권한을 받은 사람만 옮길 수 있습니다.');
  end if;
  return jsonb_build_object('name', f.file_name, 'to_name', v_to, 'rows',
    (select jsonb_agg(jsonb_build_object('id', d.id, 'storage_path', d.storage_path, 'bucket', coalesce(d.bucket, 'document-files')))
       from public.document_files d where d.id = p_file or d.parent_file_id = p_file));
end $$;

commit;
