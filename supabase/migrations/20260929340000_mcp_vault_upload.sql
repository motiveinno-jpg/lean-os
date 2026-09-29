-- AI 커넥터(MCP) 파일보관함 올리기·폴더 만들기 — 앱에서 올릴 때와 같은 규칙, 그 사람 권한(RLS) 그대로.
--   ① upload_vault_file: 서버가 형식·크기(file-rules.ts, 앱과 공용)를 보고, mcp_vault_upload_check 로
--      (그 사람으로 전환해) 폴더를 볼 수 있는지·저장공간을 확인한 뒤 2시간짜리 올리기 링크를 준다 → mcp_pending_uploads.
--   ② finish_vault_upload: 실물이 올라왔는지 확인하고 mcp_vault_register 로 (그 사람으로 전환해) 원장에 등록한다.
--      같은 폴더·같은 이름이면 앱처럼 v2·v3 로 쌓고 옛 판은 새 판 밑으로(결정 146 ③), 올린 사람·감사 기록도 같다.
--   올리기 링크만 받고 등록하지 않은 실물은 2시간 뒤 서버가 치운다(목록에 없이 저장공간만 먹지 않게).
begin;

create table if not exists public.mcp_pending_uploads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  user_id uuid not null,                  -- auth.users.id
  client_id text,
  folder_id uuid,
  file_name text not null,
  storage_path text not null unique,
  declared_size bigint not null,
  mime_type text not null,
  category text,
  tags text[] not null default '{}',
  expires_at timestamptz not null,
  done_file_id uuid,
  cleaned_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mcp_pending_uploads_open_idx on public.mcp_pending_uploads (expires_at) where done_file_id is null and cleaned_at is null;
alter table public.mcp_pending_uploads enable row level security;
revoke all on public.mcp_pending_uploads from anon, authenticated;

-- 올리기 전 확인 — 그 사람으로 전환해 폴더 권한과 저장공간을 본다
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

-- 등록 — 그 사람으로 전환해 앱 uploadFile 과 같은 순서로(판 번호 → 행 추가 → 옛 판 밑으로 → 감사 기록)
create or replace function public.mcp_vault_register(
  p_auth uuid, p_company uuid, p_folder uuid, p_name text, p_path text, p_url text,
  p_size bigint, p_mime text, p_category text, p_tags text[])
returns jsonb language plpgsql security invoker set search_path to 'public' as $$
declare v_user uuid; v_version int := 1; v_prev uuid[]; v_id uuid; v_prefix text;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
  if public.get_my_company_id() is distinct from p_company then raise exception 'company mismatch'; end if;
  --   실물 경로가 회사·폴더와 맞아야 한다 — 스토리지 RLS 가 경로의 폴더 id 로 공개 범위를 가른다
  v_prefix := p_company::text || (case when p_folder is null then '/general/' else '/folders/' || p_folder::text || '/' end);
  if left(p_path, length(v_prefix)) <> v_prefix then raise exception 'path mismatch'; end if;
  if p_folder is not null and not exists (select 1 from public.document_folders where id = p_folder) then
    raise exception 'folder not visible';
  end if;
  select id into v_user from public.users where auth_id = p_auth;
  -- 같은 폴더·같은 이름의 최신 판들 → 다음 판 번호 (동시에 두 번 등록해도 번호가 겹치지 않게 줄 세운다)
  perform pg_advisory_xact_lock(hashtextextended('vault_version:' || p_company::text || ':' || coalesce(p_folder::text, '') || ':' || p_name, 0));
  select coalesce(max(version), 0) + 1, array_agg(id) into v_version, v_prev
    from public.document_files
   where company_id = p_company and file_name = p_name and parent_file_id is null
     and document_id is null and deal_id is null and vault_doc_id is null
     and folder_id is not distinct from p_folder;
  v_version := coalesce(v_version, 1);
  insert into public.document_files (company_id, folder_id, file_name, file_url, file_size, mime_type, storage_path, bucket, category, tags, version, uploaded_by)
  values (p_company, p_folder, p_name, p_url, p_size, p_mime, p_path, 'document-files', nullif(p_category, ''), coalesce(p_tags, '{}'), v_version, v_user)
  returning id into v_id;
  if v_prev is not null and array_length(v_prev, 1) > 0 then
    update public.document_files set parent_file_id = v_id
     where company_id = p_company and (id = any(v_prev) or parent_file_id = any(v_prev));
  end if;
  insert into public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata, created_at)
  values (p_company, v_user, 'file_uploaded', 'file', v_id,
          jsonb_build_object('fileName', p_name, 'fileSize', p_size, 'mimeType', p_mime, 'bucket', 'document-files', 'via', 'ai_connector'), now());
  return jsonb_build_object('id', v_id, 'version', v_version);
end $$;

-- 폴더 만들기 — 그 사람으로 전환해 앱 createFolder 와 같은 행을 넣는다(RLS 그대로).
--   공개 범위: company(기본) · private(만든 사람만) · departments(부서 이름들). 지정 인원(members)은 앱에서.
create or replace function public.mcp_vault_create_folder(p_auth uuid, p_company uuid, p_name text, p_parent uuid, p_visibility text, p_departments text[])
returns jsonb language plpgsql security invoker set search_path to 'public' as $$
declare v_user uuid; v_id uuid; v_name text := left(trim(coalesce(p_name, '')), 100); v_vis text := coalesce(nullif(p_visibility, ''), 'company');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
  if public.get_my_company_id() is distinct from p_company then raise exception 'company mismatch'; end if;
  if v_name = '' then return jsonb_build_object('error', '폴더 이름을 적어 주세요.'); end if;
  if v_vis not in ('company', 'private', 'departments') then return jsonb_build_object('error', '공개 범위는 company·private·departments 중 하나입니다.'); end if;
  if v_vis = 'departments' and coalesce(array_length(p_departments, 1), 0) = 0 then return jsonb_build_object('error', '부서 공개는 부서 이름을 하나 이상 넣어 주세요.'); end if;
  if p_parent is not null and not exists (select 1 from public.document_folders where id = p_parent) then
    return jsonb_build_object('error', '상위 폴더가 없거나 볼 권한이 없습니다.');
  end if;
  select id into v_user from public.users where auth_id = p_auth;
  --   같은 자리에 같은 이름(내가 볼 수 있는 것)이 있으면 새로 만들지 않고 그 폴더를 돌려준다 — AI 가 같은 요청을 반복해도 한 개
  perform pg_advisory_xact_lock(hashtextextended('vault_folder:' || p_company::text || ':' || coalesce(p_parent::text, '') || ':' || lower(v_name), 0));
  select id into v_id from public.document_folders
   where company_id = p_company and parent_id is not distinct from p_parent and lower(name) = lower(v_name) limit 1;
  if v_id is not null then return jsonb_build_object('id', v_id, 'name', v_name, 'existed', true); end if;
  insert into public.document_folders (company_id, name, parent_id, visibility, target_user_ids, target_departments, created_by)
  values (p_company, v_name, p_parent, v_vis, '{}', case when v_vis = 'departments' then p_departments else '{}' end, v_user)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'name', v_name, 'visibility', v_vis, 'existed', false);
end $$;
revoke all on function public.mcp_vault_create_folder(uuid, uuid, text, uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.mcp_vault_create_folder(uuid, uuid, text, uuid, text, text[]) to service_role;

revoke all on function public.mcp_vault_upload_check(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.mcp_vault_register(uuid, uuid, uuid, text, text, text, bigint, text, text, text[]) from public, anon, authenticated;
grant execute on function public.mcp_vault_upload_check(uuid, uuid, uuid) to service_role;
grant execute on function public.mcp_vault_register(uuid, uuid, uuid, text, text, text, bigint, text, text, text[]) to service_role;

commit;
