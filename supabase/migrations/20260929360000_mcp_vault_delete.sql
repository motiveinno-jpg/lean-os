-- AI 커넥터(MCP) 파일보관함 파일 삭제 — 앱 deleteFile 과 같은 규칙, 그 사람 권한(RLS) 그대로.
--   · 누가 지울 수 있나: document_files DELETE RLS(본인이 올린 것, 남의 것은 마스터·'/documents:delete' 위임자)가 판정한다
--     — 함수 안에서 그 사람으로 전환해 지우고, 지워진 행이 0 이면 권한 없음으로 돌려준다.
--   · 지난 판까지 함께(결정 146 ③), 행 먼저·실물 나중(실물은 서버가 이 함수가 돌려준 경로만 지운다), 감사 기록 file_deleted.
--   · AI 가 번호를 잘못 짚지 않게 이름까지 맞아야 지운다. 파일보관함 파일만(문서·금고·프로젝트 첨부는 대상 아님).
begin;

create or replace function public.mcp_vault_delete_file(p_auth uuid, p_company uuid, p_file uuid, p_name text)
returns jsonb language plpgsql security invoker set search_path to 'public' as $$
declare v_user uuid; f record; v_paths text[] := '{}'; v_main text; v_olds text[];
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
  -- 행 먼저(RLS 가 막으면 0행) → 지난 판 → 실물 경로는 서버가 지운다
  delete from public.document_files where id = p_file returning storage_path into v_main;
  if not found then
    return jsonb_build_object('error', '본인이 올린 파일만 지울 수 있습니다. 다른 사람의 파일은 마스터 또는 파일 삭제 권한을 받은 사람만 지울 수 있습니다.');
  end if;
  with d as (delete from public.document_files where parent_file_id = p_file returning storage_path)
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
