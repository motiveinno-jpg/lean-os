-- 파일보관함 폴더 암호화 — 폴더(와 하위 폴더) 안 파일은 모두 그 폴더 비밀번호로 암호화된 것만 둔다.
--
--   파일 암호화(20261014160000)를 폴더 단위로 묶는다. 키는 여전히 브라우저에서만 만든다.
--   document_folders.encryption 에는 비밀번호 확인용 값(소금·IV·확인 문구를 그 키로 암호화한 것)만 둔다 —
--   올릴 때 비밀번호를 잘못 치면 그 파일만 다른 비밀번호로 잠겨 폴더 비밀번호로 안 열리는 일을 막으려고.
--   (파일 하나를 받아 무차별 대입하는 것과 같은 수준이라 확인값이 새로운 약점을 만들지 않는다)
--
--   규칙(DB 가 지킨다 — 화면·MCP·다른 경로 모두)
--   ① 암호화 폴더 아래(어느 단계든)에는 암호화된 파일만 넣고 옮길 수 있다.
--   ② 폴더를 암호화하려면 그 아래 파일이 이미 모두 암호화돼 있어야 한다(화면이 먼저 하나씩 암호화한 뒤 폴더를 표시).
--      해제는 반대로 폴더 표시를 먼저 지우고 파일을 푼다.
--   ③ 암호화 폴더 안에 또 암호화 폴더는 두지 않는다(어느 비밀번호인지 헷갈린다) — 위·아래 모두 확인.
--   ④ 암호화된 폴더를 옮길 때·폴더를 암호화 폴더 안으로 옮길 때도 ①③ 을 지킨다.
--   ⑤ 암호화·해제는 폴더를 만든 사람 또는 파일 삭제 권한(/documents:delete, 대표 포함)만. 비밀번호 바꾸기는 없다(해제 후 다시).
--   파일 이름·폴더 이름은 암호화하지 않는다 — 목록에 그대로 보인다.

alter table public.document_folders add column if not exists encryption jsonb;
comment on column public.document_folders.encryption is
  '폴더 암호화 — {v, alg, kdf, iter, salt, iv, check}. check 는 확인 문구를 폴더 비밀번호 키로 암호화한 값. 비밀번호·키는 저장하지 않는다';

alter table public.document_folders drop constraint if exists document_folders_encryption_shape;
alter table public.document_folders add constraint document_folders_encryption_shape check (
  encryption is null or (
    encryption->>'alg' = 'AES-GCM' and encryption->>'kdf' = 'PBKDF2-SHA256'
    and (encryption->>'iter') ~ '^\d+$' and (encryption->>'iter')::int >= 100000
    and coalesce(encryption->>'salt', '') <> '' and coalesce(encryption->>'iv', '') <> '' and coalesce(encryption->>'check', '') <> ''
  ));

-- 이 폴더(자신 포함 위로)에서 가장 가까운 암호화 폴더 — 트리거 안에서만 쓴다
create or replace function public._vault_locked_root(p_folder uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_cur uuid := p_folder; v_enc jsonb; v_parent uuid; v_hops int := 0;
begin
  while v_cur is not null and v_hops < 200 loop
    select encryption, parent_id into v_enc, v_parent from public.document_folders where id = v_cur;
    if not found then return null; end if;
    if v_enc is not null then return v_cur; end if;
    v_cur := v_parent; v_hops := v_hops + 1;
  end loop;
  return null;
end $$;
revoke all on function public._vault_locked_root(uuid) from public, anon, authenticated;

-- ① 파일: 암호화 폴더 아래에는 암호화된 파일만
create or replace function public.document_files_folder_lock_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.folder_id is null or new.encryption is not null then return new; end if;
  if tg_op = 'UPDATE' and new.folder_id is not distinct from old.folder_id and old.encryption is null then
    return new;   -- 폴더도 암호화 상태도 그대로인 수정(이름·태그 등)은 통과
  end if;
  if public._vault_locked_root(new.folder_id) is not null then
    raise exception '암호화 폴더에는 암호화된 파일만 둘 수 있습니다. 폴더 비밀번호로 암호화해서 올려 주세요.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_document_files_folder_lock_guard on public.document_files;
create trigger trg_document_files_folder_lock_guard
  before insert or update of folder_id, encryption on public.document_files
  for each row execute function public.document_files_folder_lock_guard();

-- ②~⑤ 폴더
create or replace function public.document_folders_lock_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_plain int; v_nested int; v_above uuid; v_sub_locked int; v_sub_plain int;
begin
  -- 암호화 표시를 바꾸는 경우
  if tg_op = 'UPDATE' and new.encryption is distinct from old.encryption then
    if (select auth.uid()) is not null
       and old.created_by is distinct from (select public.current_app_user_id())
       and not (select public.has_perm('/documents:delete')) then
      raise exception '폴더를 만든 사람이나 파일 삭제 권한이 있는 사람만 폴더를 암호화하거나 해제할 수 있습니다.' using errcode = 'P0001';
    end if;
    if old.encryption is not null and new.encryption is not null then
      raise exception '폴더 비밀번호는 바꿀 수 없습니다. 암호화를 해제한 뒤 새 비밀번호로 다시 암호화해 주세요.' using errcode = 'P0001';
    end if;
    if new.encryption is not null then
      if new.parent_id is not null and public._vault_locked_root(new.parent_id) is not null then
        raise exception '이미 암호화된 폴더 안에 있어 따로 암호화할 수 없습니다.' using errcode = 'P0001';
      end if;
      with recursive t as (
        select id from public.document_folders where parent_id = new.id
        union all select c.id from public.document_folders c join t on c.parent_id = t.id
      ) select count(*) into v_nested from public.document_folders f join t using (id) where f.encryption is not null;
      if v_nested > 0 then
        raise exception '안에 이미 암호화된 하위 폴더가 있습니다. 그 폴더의 암호화를 먼저 해제해 주세요.' using errcode = 'P0001';
      end if;
      with recursive t as (
        select new.id as id
        union all select c.id from public.document_folders c join t on c.parent_id = t.id
      ) select count(*) into v_plain from public.document_files d join t on d.folder_id = t.id where d.encryption is null;
      if v_plain > 0 then
        raise exception '폴더 안에 아직 암호화되지 않은 파일이 %개 있습니다.', v_plain using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- 폴더를 다른 곳으로 옮기는 경우
  if tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id and new.parent_id is not null then
    v_above := public._vault_locked_root(new.parent_id);
    if v_above is not null then
      if new.encryption is not null then
        raise exception '암호화 폴더 안으로 다른 암호화 폴더를 옮길 수 없습니다.' using errcode = 'P0001';
      end if;
      with recursive t as (
        select new.id as id
        union all select c.id from public.document_folders c join t on c.parent_id = t.id
      ) select (select count(*) from public.document_folders f join t using (id) where f.encryption is not null),
               (select count(*) from public.document_files d join t on d.folder_id = t.id where d.encryption is null)
          into v_sub_locked, v_sub_plain;
      if v_sub_locked > 0 then
        raise exception '안에 암호화된 하위 폴더가 있어 암호화 폴더 안으로 옮길 수 없습니다.' using errcode = 'P0001';
      end if;
      if v_sub_plain > 0 then
        raise exception '암호화되지 않은 파일이 %개 있어 암호화 폴더 안으로 옮길 수 없습니다.', v_sub_plain using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- 새 폴더를 처음부터 암호화로 만드는 경우(빈 폴더라 ③ 위쪽만 보면 된다)
  if tg_op = 'INSERT' and new.encryption is not null and new.parent_id is not null
     and public._vault_locked_root(new.parent_id) is not null then
    raise exception '이미 암호화된 폴더 안에 있어 따로 암호화할 수 없습니다.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_document_folders_lock_guard on public.document_folders;
create trigger trg_document_folders_lock_guard
  before insert or update of encryption, parent_id on public.document_folders
  for each row execute function public.document_folders_lock_guard();

-- MCP(AI 연결)는 암호화를 못 한다 — 암호화 폴더에는 올리지 않는다
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
  if p_folder is not null and exists (
    with recursive up as (
      select id, parent_id, encryption from public.document_folders where id = p_folder
      union all select f.id, f.parent_id, f.encryption from public.document_folders f join up on f.id = up.parent_id
    ) select 1 from up where encryption is not null) then
    return jsonb_build_object('ok', false, 'error', '암호화 폴더에는 AI 연결로 올릴 수 없습니다. 오너뷰 파일보관함에서 폴더 비밀번호로 올려 주세요.');
  end if;
  select * into s from public.get_company_storage(p_company) limit 1;
  return jsonb_build_object('ok', true, 'user_id', v_user,
    'used_bytes', coalesce(s.used_bytes, 0), 'quota_bytes', coalesce(s.quota_bytes, 0));
end $$;
revoke all on function public.mcp_vault_upload_check(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.mcp_vault_upload_check(uuid, uuid, uuid) to service_role;
