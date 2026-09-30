-- AI 커넥터(MCP) 파일보관함 폴더 옮기기·이름 바꾸기·지우기, 파일을 다른 폴더로 옮기기 — 그 사람 권한(RLS) 그대로.
--   폴더 트리 규칙(순환 금지·범위 상속·같은 자리 같은 이름 금지·비어 있어야 삭제)은 20260930200000 의 트리거·제약이
--   그대로 막는다. 여기서는 그 거절을 AI 가 읽을 문장으로 바꿔 돌려준다.
--   파일 옮기기는 저장소 실물도 옮겨야 해서(경로의 폴더 id 로 스토리지 RLS 가 판단) 여기서는 권한 확인과 옮길 행만
--   돌려주고, 실물 이동·행 갱신은 서버(mcp-vault.ts)가 한다 — 앱 moveFilesToFolder 와 같은 순서.
begin;

create or replace function public.mcp_vault_move_folder(p_auth uuid, p_company uuid, p_folder uuid, p_parent uuid)
returns jsonb language plpgsql security invoker set search_path to 'public' as $$
declare f record; v_n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
  if public.get_my_company_id() is distinct from p_company then raise exception 'company mismatch'; end if;
  select id, name, parent_id into f from public.document_folders where id = p_folder;
  if f.id is null then return jsonb_build_object('error', '폴더가 없거나 볼 권한이 없습니다.'); end if;
  if f.parent_id is not distinct from p_parent then return jsonb_build_object('id', f.id, 'name', f.name, 'moved', false, 'note', '이미 그 자리에 있습니다.'); end if;
  if p_parent is not null and not exists (select 1 from public.document_folders where id = p_parent) then
    return jsonb_build_object('error', '옮길 상위 폴더가 없거나 볼 권한이 없습니다.');
  end if;
  begin
    update public.document_folders set parent_id = p_parent, updated_at = now() where id = p_folder;
    get diagnostics v_n = row_count;
  exception
    when unique_violation then return jsonb_build_object('error', '옮길 자리에 같은 이름의 폴더가 이미 있습니다. 이름을 바꾼 뒤 옮겨 주세요.');
    when check_violation or foreign_key_violation then return jsonb_build_object('error', sqlerrm);
  end;
  if v_n = 0 then return jsonb_build_object('error', '폴더를 만든 사람(또는 파일 삭제 권한자)만 옮길 수 있습니다.'); end if;
  return jsonb_build_object('id', f.id, 'name', f.name, 'moved', true, 'parent_id', p_parent,
    'note', case when p_parent is not null then '옮긴 폴더와 그 안의 폴더는 새 상위 폴더의 공개 범위를 따릅니다.' else '맨 위로 옮겼습니다. 공개 범위는 그대로입니다.' end);
end $$;

create or replace function public.mcp_vault_rename_folder(p_auth uuid, p_company uuid, p_folder uuid, p_name text)
returns jsonb language plpgsql security invoker set search_path to 'public' as $$
declare f record; v_n int; v_name text := left(trim(coalesce(p_name, '')), 100);
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
  if public.get_my_company_id() is distinct from p_company then raise exception 'company mismatch'; end if;
  if v_name = '' then return jsonb_build_object('error', '새 이름을 적어 주세요.'); end if;
  select id, name into f from public.document_folders where id = p_folder;
  if f.id is null then return jsonb_build_object('error', '폴더가 없거나 볼 권한이 없습니다.'); end if;
  begin
    update public.document_folders set name = v_name, updated_at = now() where id = p_folder;
    get diagnostics v_n = row_count;
  exception when unique_violation then
    return jsonb_build_object('error', '같은 자리에 같은 이름의 폴더가 이미 있습니다.');
  end;
  if v_n = 0 then return jsonb_build_object('error', '폴더를 만든 사람(또는 파일 삭제 권한자)만 이름을 바꿀 수 있습니다.'); end if;
  return jsonb_build_object('id', f.id, 'old_name', f.name, 'name', v_name, 'renamed', true);
end $$;

-- 지우기: 비어 있어야(하위 폴더·파일·지난 판 없음) — 이름까지 맞아야 지운다(엉뚱한 id 방지)
create or replace function public.mcp_vault_delete_folder(p_auth uuid, p_company uuid, p_folder uuid, p_name text)
returns jsonb language plpgsql security invoker set search_path to 'public' as $$
declare v_user uuid; f record; v_n int; v_kids int; v_files int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
  if public.get_my_company_id() is distinct from p_company then raise exception 'company mismatch'; end if;
  select id, name, parent_id into f from public.document_folders where id = p_folder;
  if f.id is null then return jsonb_build_object('error', '폴더가 없거나 볼 권한이 없습니다.'); end if;
  if f.name is distinct from p_name then
    return jsonb_build_object('error', format('이름이 맞지 않아 지우지 않았습니다(이 번호의 폴더는 "%s").', f.name));
  end if;
  --   안 보이는 하위 폴더·파일까지 세야 한다(보이는 것만 세면 '비었다'고 착각) — 개수는 정의자 권한 함수로
  select coalesce(max(kids), 0), coalesce(max(files), 0) into v_kids, v_files from public.vault_folder_contents(p_folder);
  if v_kids > 0 or v_files > 0 then
    return jsonb_build_object('error', format('폴더가 비어 있지 않아 지우지 않았습니다(하위 폴더 %s개, 파일 %s개). 안을 먼저 옮기거나 지워 주세요.', v_kids, v_files));
  end if;
  delete from public.document_folders where id = p_folder;
  get diagnostics v_n = row_count;
  if v_n = 0 then return jsonb_build_object('error', '폴더를 만든 사람(또는 파일 삭제 권한자)만 지울 수 있습니다.'); end if;
  select id into v_user from public.users where auth_id = p_auth;
  insert into public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata, created_at)
  values (p_company, v_user, 'folder_deleted', 'file', p_folder, jsonb_build_object('folderName', f.name, 'via', 'ai_connector'), now());
  return jsonb_build_object('deleted', true, 'id', f.id, 'name', f.name);
end $$;

--   부르는 사람 회사의 폴더만 센다(다른 회사 폴더 id 를 넣으면 0·0)
create or replace function public.vault_folder_contents(p_folder uuid)
returns table (kids integer, files integer)
language sql stable security definer set search_path to 'public' as $$
  select (select count(*)::int from public.document_folders where parent_id = p_folder),
         (select count(*)::int from public.document_files where folder_id = p_folder)
   where exists (select 1 from public.document_folders where id = p_folder and company_id = public.get_my_company_id())
$$;
revoke all on function public.vault_folder_contents(uuid) from public, anon;
grant execute on function public.vault_folder_contents(uuid) to authenticated, service_role;

-- 파일 옮기기 계획 — 그 사람으로: 파일·대상 폴더가 보이는지, 옮길 권한(본인 파일 또는 파일 삭제 권한)이 있는지.
--   옮길 행 = 최신 판 + 지난 판(지난 판도 폴더를 따라간다).
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
  select name into v_to from public.document_folders where id = p_folder;
  if v_to is null then return jsonb_build_object('error', '옮길 폴더가 없거나 볼 권한이 없습니다.'); end if;
  if f.folder_id = p_folder then return jsonb_build_object('name', f.file_name, 'same', true); end if;
  if not (f.uploaded_by = (select public.current_app_user_id()) or (select public.has_perm('/documents:delete'))) then
    return jsonb_build_object('error', '본인이 올린 파일만 옮길 수 있습니다. 다른 사람의 파일은 마스터 또는 파일 삭제 권한을 받은 사람만 옮길 수 있습니다.');
  end if;
  return jsonb_build_object('name', f.file_name, 'to_name', v_to, 'rows',
    (select jsonb_agg(jsonb_build_object('id', d.id, 'storage_path', d.storage_path, 'bucket', coalesce(d.bucket, 'document-files')))
       from public.document_files d where d.id = p_file or d.parent_file_id = p_file));
end $$;

revoke all on function public.mcp_vault_move_folder(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.mcp_vault_rename_folder(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.mcp_vault_delete_folder(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.mcp_vault_file_move_plan(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.mcp_vault_move_folder(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.mcp_vault_rename_folder(uuid, uuid, uuid, text) to service_role;
grant execute on function public.mcp_vault_delete_folder(uuid, uuid, uuid, text) to service_role;
grant execute on function public.mcp_vault_file_move_plan(uuid, uuid, uuid, uuid) to service_role;

commit;
