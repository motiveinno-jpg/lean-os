-- 파일보관함 폴더 트리 — 폴더 안에 폴더를 몇 단계든 만들고, 파일은 반드시 폴더 안에 둔다.
--   ① 하위 폴더는 맨 위 폴더의 공개 범위를 물려받는다. 폴더마다 범위가 다르면 위는 안 보이고 아래만 보이는
--      '부모 없는 폴더'가 생긴다. RLS 를 재귀로 짜면 행마다 조상을 거슬러 올라가 느려지므로, 규칙은 그대로 두고
--      값을 트리 전체에 같게 맞춘다. 범위는 맨 위 폴더에서만 바꾼다.
--   ② 순환 금지 — 폴더를 자기 자신이나 자기 하위 폴더 안으로 옮기지 못한다. 다른 회사 폴더를 부모로 삼지 못한다.
--   ③ 비어 있는 폴더만 지운다 — 종전 parent_id CASCADE · folder_id SET NULL 이면 하위 폴더를 지울 때
--      그 안 파일이 폴더 없이 떨어졌다. NO ACTION(문장 끝 검사)이라 회사 통째 삭제의 연쇄는 그대로 통과한다.
--   ④ 파일보관함 파일(문서·금고·딜 첨부가 아닌 것)은 folder_id 필수.
--   ⑤ 같은 자리에 같은 이름 폴더 금지(대소문자·앞뒤 공백 무시) — 경로가 하나로 읽히게.
--   MCP 함수: 올리기는 폴더 필수, 목록은 폴더 경로를 같이 준다, 이름 충돌은 문장으로 돌려준다.
begin;

-- ⑥ 트리·폴더 열기용 인덱스
create index if not exists document_folders_company_parent_idx on public.document_folders (company_id, parent_id);
create index if not exists document_files_folder_idx on public.document_files (folder_id) where parent_file_id is null;

-- ⑤
create unique index if not exists uq_document_folders_sibling_name
  on public.document_folders (company_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));

-- ③
alter table public.document_folders drop constraint if exists document_folders_parent_id_fkey;
alter table public.document_folders add constraint document_folders_parent_id_fkey
  foreign key (parent_id) references public.document_folders(id);
alter table public.document_files drop constraint if exists document_files_folder_id_fkey;
alter table public.document_files add constraint document_files_folder_id_fkey
  foreign key (folder_id) references public.document_folders(id);

-- ④ 옮길 파일은 먼저 폴더로 옮겼다(최상위 6건 → 같은 이름 업체 폴더·미분류)
alter table public.document_files drop constraint if exists document_files_vault_needs_folder;
alter table public.document_files add constraint document_files_vault_needs_folder
  check (folder_id is not null or document_id is not null or vault_doc_id is not null or deal_id is not null);

-- ①② 넣기·옮기기 때 부모를 확인하고 범위를 물려받는다. 호출한 사람 권한으로 부모를 읽는다 —
--   볼 수 없는 폴더 밑에는 만들 수 없다.
create or replace function public.document_folders_tree_guard()
returns trigger language plpgsql set search_path to 'public' as $$
declare p record; v_cur uuid; v_hops int := 0;
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then
    raise exception using errcode = '23514', message = '폴더를 자기 자신 안으로 옮길 수 없습니다.';
  end if;
  select id, company_id, visibility, target_user_ids, target_departments into p
    from public.document_folders where id = new.parent_id;
  if not found then
    raise exception using errcode = '23503', message = '상위 폴더가 없거나 볼 권한이 없습니다.';
  end if;
  if p.company_id <> new.company_id then
    raise exception using errcode = '23514', message = '다른 회사 폴더 안에는 만들 수 없습니다.';
  end if;
  if tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id then
    v_cur := new.parent_id;
    while v_cur is not null loop
      if v_cur = new.id then
        raise exception using errcode = '23514', message = '폴더를 자기 하위 폴더 안으로 옮길 수 없습니다.';
      end if;
      v_hops := v_hops + 1;
      if v_hops > 200 then raise exception using errcode = '23514', message = '폴더 단계가 너무 깊습니다.'; end if;
      select parent_id into v_cur from public.document_folders where id = v_cur;
    end loop;
  end if;
  --   같은 자리에서 범위만 바꾸려는 경우(하위 폴더 직접 변경)는 조용히 되돌리지 않고 이유를 말한다
  if tg_op = 'UPDATE' and new.parent_id is not distinct from old.parent_id
     and (new.visibility, new.target_user_ids, new.target_departments) is distinct from (old.visibility, old.target_user_ids, old.target_departments)
     and (new.visibility, new.target_user_ids, new.target_departments) is distinct from (p.visibility, p.target_user_ids, p.target_departments) then
    raise exception using errcode = '23514', message = '하위 폴더는 맨 위 폴더의 공개 범위를 따릅니다. 맨 위 폴더에서 바꿔 주세요.';
  end if;
  new.visibility := p.visibility;
  new.target_user_ids := p.target_user_ids;
  new.target_departments := p.target_departments;
  return new;
end $$;

drop trigger if exists document_folders_tree_guard on public.document_folders;
create trigger document_folders_tree_guard
  before insert or update of parent_id, visibility, target_user_ids, target_departments, company_id on public.document_folders
  for each row execute function public.document_folders_tree_guard();

-- ① 맨 위(또는 옮겨진) 폴더의 범위가 바뀌면 아래로 내려 보낸다. 하위 폴더를 만든 사람이 달라도
--   맞춰야 하므로 정의자 권한 — 이 폴더의 직계 자식만 고치고, 자식의 같은 트리거가 다음 단계를 고친다.
create or replace function public.document_folders_propagate_scope()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if (new.visibility, new.target_user_ids, new.target_departments) is distinct from (old.visibility, old.target_user_ids, old.target_departments) then
    update public.document_folders c
       set visibility = new.visibility, target_user_ids = new.target_user_ids,
           target_departments = new.target_departments, updated_at = now()
     where c.parent_id = new.id
       and (c.visibility, c.target_user_ids, c.target_departments) is distinct from (new.visibility, new.target_user_ids, new.target_departments);
  end if;
  return null;
end $$;
revoke all on function public.document_folders_propagate_scope() from public, anon, authenticated;

drop trigger if exists document_folders_propagate_scope on public.document_folders;
create trigger document_folders_propagate_scope
  after update on public.document_folders
  for each row execute function public.document_folders_propagate_scope();

-- ── MCP ──
-- 목록: 폴더마다 경로(맨 위부터 이름들), 파일마다 폴더 경로
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
            from public.document_files d join t fo on fo.id = d.folder_id
           where d.parent_file_id is null and d.document_id is null and d.vault_doc_id is null and d.deal_id is null
             and (p_folder is null or d.folder_id = p_folder)
             and (v_q is null or d.file_name ilike '%' || v_q || '%' or array_to_string(d.tags, ' ') ilike '%' || v_q || '%'
                  or fo.path ilike '%' || v_q || '%')
           order by d.created_at desc
           limit least(greatest(coalesce(p_limit, 100), 1), 300)) s), '[]'::jsonb)
    )
  );
end $$;

-- 올리기 확인: 폴더 필수
create or replace function public.mcp_vault_upload_check(p_auth uuid, p_company uuid, p_folder uuid)
returns jsonb language plpgsql security invoker set search_path to 'public' as $$
declare v_user uuid; s record;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
  if public.get_my_company_id() is distinct from p_company then raise exception 'company mismatch'; end if;
  select id into v_user from public.users where auth_id = p_auth;
  if p_folder is null then
    return jsonb_build_object('ok', false, 'error', '파일은 폴더 안에만 올릴 수 있습니다. folder_id 를 넣어 주세요(list_vault_files 의 folders, 없으면 create_vault_folder).');
  end if;
  if not exists (select 1 from public.document_folders where id = p_folder) then
    return jsonb_build_object('ok', false, 'error', '폴더가 없거나 볼 권한이 없습니다.');
  end if;
  select * into s from public.get_company_storage(p_company) limit 1;
  return jsonb_build_object('ok', true, 'user_id', v_user,
    'used_bytes', coalesce(s.used_bytes, 0), 'quota_bytes', coalesce(s.quota_bytes, 0));
end $$;

-- 폴더 만들기: 하위 폴더는 부모 범위를 물려받고(트리거), 보이지 않는 같은 이름 폴더와 부딪히면 문장으로
create or replace function public.mcp_vault_create_folder(p_auth uuid, p_company uuid, p_name text, p_parent uuid, p_visibility text, p_departments text[])
returns jsonb language plpgsql security invoker set search_path to 'public' as $$
declare v_user uuid; v_id uuid; v_name text := left(trim(coalesce(p_name, '')), 100); v_vis text := coalesce(nullif(p_visibility, ''), 'company'); v_real text;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
  if public.get_my_company_id() is distinct from p_company then raise exception 'company mismatch'; end if;
  if v_name = '' then return jsonb_build_object('error', '폴더 이름을 적어 주세요.'); end if;
  if v_vis not in ('company', 'private', 'departments') then return jsonb_build_object('error', '공개 범위는 company·private·departments 중 하나입니다.'); end if;
  if p_parent is null and v_vis = 'departments' and coalesce(array_length(p_departments, 1), 0) = 0 then return jsonb_build_object('error', '부서 공개는 부서 이름을 하나 이상 넣어 주세요.'); end if;
  if p_parent is not null and not exists (select 1 from public.document_folders where id = p_parent) then
    return jsonb_build_object('error', '상위 폴더가 없거나 볼 권한이 없습니다.');
  end if;
  select id into v_user from public.users where auth_id = p_auth;
  perform pg_advisory_xact_lock(hashtextextended('vault_folder:' || p_company::text || ':' || coalesce(p_parent::text, '') || ':' || lower(v_name), 0));
  select id into v_id from public.document_folders
   where company_id = p_company and parent_id is not distinct from p_parent and lower(btrim(name)) = lower(v_name) limit 1;
  if v_id is not null then return jsonb_build_object('id', v_id, 'name', v_name, 'existed', true); end if;
  begin
    insert into public.document_folders (company_id, name, parent_id, visibility, target_user_ids, target_departments, created_by)
    values (p_company, v_name, p_parent, v_vis, '{}', case when v_vis = 'departments' then p_departments else '{}' end, v_user)
    returning id, visibility into v_id, v_real;
  exception when unique_violation then
    return jsonb_build_object('error', '같은 자리에 같은 이름의 폴더가 이미 있습니다(볼 권한이 없는 폴더일 수 있습니다). 다른 이름을 써 주세요.');
  end;
  return jsonb_build_object('id', v_id, 'name', v_name, 'visibility', v_real, 'existed', false,
    'note', case when p_parent is not null then '하위 폴더는 상위 폴더의 공개 범위를 따릅니다.' end);
end $$;

revoke all on function public.mcp_vault_files(uuid, uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.mcp_vault_upload_check(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.mcp_vault_create_folder(uuid, uuid, text, uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.mcp_vault_files(uuid, uuid, uuid, text, integer) to service_role;
grant execute on function public.mcp_vault_upload_check(uuid, uuid, uuid) to service_role;
grant execute on function public.mcp_vault_create_folder(uuid, uuid, text, uuid, text, text[]) to service_role;

commit;
