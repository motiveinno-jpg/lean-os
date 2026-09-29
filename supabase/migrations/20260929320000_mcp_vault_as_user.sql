-- AI 커넥터(MCP) 파일보관함 조회 — 그 사람의 권한(RLS) 그대로.
--   폴더 공개 범위(만든 사람·회사 전체·지정 인원·지정 부서…)를 여기서 다시 짜면 앱 규칙과 갈라진다.
--   그래서 함수 안에서 role 을 authenticated 로 바꾸고 JWT 클레임에 그 사람을 넣어 조회한다 —
--   document_files·document_folders 의 RLS 가 앱 화면과 똑같이 걸린다(2026-09-29 실측: 직원 계정은 자기에게 보이는 것만).
--   서버(service_role)만 부를 수 있다. p_company 는 토큰의 회사 — 지금 회사와 다르면(회사 이동) 거절.
--   목록 조건은 파일보관함 화면과 같다: 최신 판만, 파일보관함에 직접 올린 것만(문서·금고·프로젝트 첨부 제외).
begin;

create or replace function public.mcp_vault_files(p_auth uuid, p_company uuid, p_folder uuid default null, p_query text default null, p_limit integer default 100)
returns jsonb language plpgsql security invoker set search_path to 'public' as $$
declare v_q text := nullif(trim(coalesce(p_query, '')), '');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
  if public.get_my_company_id() is distinct from p_company then raise exception 'company mismatch'; end if;
  return jsonb_build_object(
    'folders', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'parent_id', f.parent_id) order by f.name)
                           from public.document_folders f), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
        select jsonb_build_object('id', d.id, 'name', d.file_name, 'folder', fo.name, 'folder_id', d.folder_id,
                                  'size', d.file_size, 'mime_type', d.mime_type, 'category', d.category, 'tags', d.tags,
                                  'version', d.version, 'created_at', d.created_at) x
          from public.document_files d left join public.document_folders fo on fo.id = d.folder_id
         where d.parent_file_id is null and d.document_id is null and d.vault_doc_id is null and d.deal_id is null
           and (p_folder is null or d.folder_id = p_folder)
           and (v_q is null or d.file_name ilike '%' || v_q || '%' or array_to_string(d.tags, ' ') ilike '%' || v_q || '%'
                or fo.name ilike '%' || v_q || '%')
         order by d.created_at desc
         limit least(greatest(coalesce(p_limit, 100), 1), 300)) s), '[]'::jsonb)
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
                                    'folder', fo.name, 'version', d.version, 'created_at', d.created_at)
            from public.document_files d left join public.document_folders fo on fo.id = d.folder_id
           where d.id = p_file);
end $$;

revoke all on function public.mcp_vault_files(uuid, uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.mcp_vault_file(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.mcp_vault_files(uuid, uuid, uuid, text, integer) to service_role;
grant execute on function public.mcp_vault_file(uuid, uuid, uuid) to service_role;

commit;
