-- AI 연결(MCP) 파일 목록에서 암호화 폴더 안을 감춘다.
--   파일보관함 화면은 암호화 폴더를 비밀번호를 맞히기 전엔 열지 않는다(안의 파일·하위 폴더 이름·개수 모두).
--   AI 는 비밀번호를 받을 수 없으므로 목록에는 암호화 폴더 자체만(locked: true) 내놓고, 그 안의 하위 폴더·파일은 뺀다.
--   검색어로도 찾히지 않는다. 내용 읽기·내려받기는 이미 잠긴 파일을 거절한다(src/lib/mcp-vault.ts).
create or replace function public.mcp_vault_files(p_auth uuid, p_company uuid, p_folder uuid default null, p_query text default null, p_limit integer default 100)
returns jsonb language plpgsql security invoker set search_path to 'public' as $$
declare v_q text := nullif(trim(coalesce(p_query, '')), '');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
  if public.get_my_company_id() is distinct from p_company then raise exception 'company mismatch'; end if;
  return (
    with recursive t as (
      --   inside = 이 폴더가 암호화 폴더 안(자신은 제외)에 있다 / sealed = 이 폴더 자신 또는 위가 암호화
      select f.id, f.name, f.parent_id, f.name::text as path, 1 as d, false as inside, (f.encryption is not null) as sealed
        from public.document_folders f where f.parent_id is null
      union all
      select c.id, c.name, c.parent_id, t.path || ' › ' || c.name, t.d + 1, t.sealed, t.sealed or c.encryption is not null
        from public.document_folders c join t on c.parent_id = t.id where t.d < 200
    )
    select jsonb_build_object(
      'folders', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'parent_id', p.parent_id, 'path', p.path, 'locked', p.sealed) order by p.path)
                             from t p where not p.inside), '[]'::jsonb),
      'files', coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
          select jsonb_build_object('id', d.id, 'name', d.file_name, 'folder', fo.path, 'folder_id', d.folder_id,
                                    'size', d.file_size, 'mime_type', d.mime_type, 'category', d.category, 'tags', d.tags,
                                    'version', d.version, 'created_at', d.created_at, 'locked', d.encryption is not null) x
            from public.document_files d left join t fo on fo.id = d.folder_id
           where d.parent_file_id is null and d.document_id is null and d.vault_doc_id is null and d.deal_id is null
             and (p_folder is null or d.folder_id = p_folder)
             and (d.folder_id is null or (fo.id is not null and not fo.sealed))   -- 폴더 안 파일은 그 폴더가 보이고 암호화 폴더 안이 아닐 때만
             and (v_q is null or d.file_name ilike '%' || v_q || '%' or array_to_string(d.tags, ' ') ilike '%' || v_q || '%'
                  or coalesce(fo.path, '') ilike '%' || v_q || '%')
           order by d.created_at desc
           limit least(greatest(coalesce(p_limit, 100), 1), 300)) s), '[]'::jsonb)
    )
  );
end $$;
revoke all on function public.mcp_vault_files(uuid, uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.mcp_vault_files(uuid, uuid, uuid, text, integer) to service_role;
