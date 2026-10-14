-- 파일보관함 잠금 — 비밀번호를 알아야만 열리는 파일.
--
--   암호화·복호화는 브라우저에서만 한다(src/lib/vault-crypto.ts). 저장소에는 잠긴 덩어리만, DB 에는 화면용 정보만
--   (형식·원래 크기·방식) 남고 비밀번호·키는 어디에도 없다. 그래서 운영자·AI(MCP)도 내용을 못 보고, 잊으면 못 되살린다.
--
--   encryption 칸 규칙
--   ① 잠그기·풀기는 실물을 새로 올려 바꾼다 — 칸만 바꾸면(실물은 그대로) 잠긴 덩어리를 원본처럼 내려주거나
--      원본을 잠긴 것처럼 보이게 된다. storage_path 가 같은 채로 칸이 바뀌면 거절한다.
--   ② 잠그기·풀기는 올린 사람 또는 파일 삭제 권한(/documents:delete, 대표 포함)만 — 남의 파일을 내 비밀번호로
--      잠가 다른 사람이 못 열게 만드는 일을 막는다.

alter table public.document_files add column if not exists encryption jsonb;
comment on column public.document_files.encryption is
  '잠금(브라우저 암호화) 정보 — {v, alg, kdf, iter, mime, size}. null 이면 잠기지 않은 파일. 비밀번호·키는 저장하지 않는다';

alter table public.document_files drop constraint if exists document_files_encryption_shape;
alter table public.document_files add constraint document_files_encryption_shape check (
  encryption is null or (
    encryption->>'alg' = 'AES-GCM' and encryption->>'kdf' = 'PBKDF2-SHA256'
    and (encryption->>'iter') ~ '^\d+$' and (encryption->>'iter')::int >= 100000
  ));

create or replace function public.document_files_lock_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.encryption is not distinct from old.encryption then return new; end if;
  if new.storage_path is not distinct from old.storage_path then
    raise exception '잠금 상태는 파일을 다시 올릴 때만 바뀝니다.' using errcode = 'P0001';
  end if;
  --   서버 쪽 작업(service_role·마이그레이션)은 auth.uid() 가 없다 — 사람 요청만 권한을 본다
  if (select auth.uid()) is not null
     and old.uploaded_by is distinct from (select public.current_app_user_id())
     and not (select public.has_perm('/documents:delete')) then
    raise exception '파일을 올린 사람이나 파일 삭제 권한이 있는 사람만 잠그거나 풀 수 있습니다.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_document_files_lock_guard on public.document_files;
create trigger trg_document_files_lock_guard
  before update of encryption, storage_path on public.document_files
  for each row execute function public.document_files_lock_guard();

-- MCP(AI 연결) 목록·파일 정보에 잠김 여부를 싣는다 — 잠긴 파일은 읽기·내려받기를 하지 않는다(src/lib/mcp-vault.ts)
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
                                    'version', d.version, 'created_at', d.created_at, 'locked', d.encryption is not null) x
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

create or replace function public.mcp_vault_file(p_auth uuid, p_company uuid, p_file uuid)
returns jsonb language plpgsql security invoker set search_path to 'public' as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
  if public.get_my_company_id() is distinct from p_company then raise exception 'company mismatch'; end if;
  return (select jsonb_build_object('id', d.id, 'name', d.file_name, 'mime_type', d.mime_type, 'size', d.file_size,
                                    'bucket', coalesce(d.bucket, 'document-files'), 'storage_path', d.storage_path,
                                    'folder', fo.name, 'version', d.version, 'created_at', d.created_at,
                                    'locked', d.encryption is not null)
            from public.document_files d left join public.document_folders fo on fo.id = d.folder_id
           where d.id = p_file);
end $$;

revoke all on function public.mcp_vault_files(uuid, uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.mcp_vault_file(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.mcp_vault_files(uuid, uuid, uuid, text, integer) to service_role;
grant execute on function public.mcp_vault_file(uuid, uuid, uuid) to service_role;
