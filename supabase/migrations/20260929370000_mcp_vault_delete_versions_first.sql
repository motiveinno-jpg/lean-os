-- mcp_vault_delete_file 수정 — 지난 판 목록을 최신 판을 지우기 전에 잡는다(parent_file_id ON DELETE SET NULL 이라
--   먼저 지우면 지난 판이 최신 파일로 되살아났다). 20260929360000 의 함수를 이 정의로 바꾼다.
begin;

create or replace function public.mcp_vault_delete_file(p_auth uuid, p_company uuid, p_file uuid, p_name text)
returns jsonb language plpgsql security invoker set search_path to 'public' as $$
declare v_user uuid; f record; v_paths text[] := '{}'; v_main text; v_olds text[]; v_old_ids uuid[];
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
  if public.get_my_company_id() is distinct from p_company then raise exception 'company mismatch'; end if;
  select id, file_name, file_size, mime_type, storage_path, folder_id, version into f
    from public.document_files
   where id = p_file and parent_file_id is null and document_id is null and vault_doc_id is null and deal_id is null;
  if f.id is null then return jsonb_build_object('error', '파일이 없거나 볼 권한이 없습니다.'); end if;
  if f.file_name is distinct from p_name then
    return jsonb_build_object('error', format('이름이 맞지 않아 지우지 않았습니다(이 번호의 파일은 "%s"). list_vault_files 로 다시 확인하세요.', f.file_name));
  end if;
  select id into v_user from public.users where auth_id = p_auth;
  -- 지난 판 목록부터 잡는다 — parent_file_id 는 ON DELETE SET NULL 이라 최신 판을 먼저 지우면
  --   지난 판의 연결이 끊겨 최신 파일로 되살아난다(앱 deleteFile 도 먼저 모은다. 2026-09-29 실측)
  select coalesce(array_agg(id), '{}') into v_old_ids from public.document_files where parent_file_id = p_file;
  -- 행 먼저(RLS 가 막으면 0행) → 지난 판 → 실물 경로는 서버가 지운다
  delete from public.document_files where id = p_file returning storage_path into v_main;
  if not found then
    return jsonb_build_object('error', '본인이 올린 파일만 지울 수 있습니다. 다른 사람의 파일은 마스터 또는 파일 삭제 권한을 받은 사람만 지울 수 있습니다.');
  end if;
  with d as (delete from public.document_files where id = any(v_old_ids) returning storage_path)
  select coalesce(array_agg(storage_path) filter (where storage_path is not null), '{}') into v_olds from d;
  v_paths := array_remove(array_prepend(v_main, v_olds), null);
  insert into public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata, created_at)
  values (p_company, v_user, 'file_deleted', 'file', p_file,
          jsonb_build_object('fileName', f.file_name, 'fileSize', f.file_size, 'mimeType', f.mime_type, 'bucket', 'document-files',
                             'versionsRemoved', coalesce(array_length(v_olds, 1), 0), 'via', 'ai_connector'), now());
  return jsonb_build_object('deleted', true, 'name', f.file_name, 'paths', to_jsonb(v_paths), 'versions_removed', coalesce(array_length(v_olds, 1), 0));
end $$;

revoke all on function public.mcp_vault_delete_file(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mcp_vault_delete_file(uuid, uuid, uuid, text) to service_role;

commit;
