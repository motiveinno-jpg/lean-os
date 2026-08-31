-- 주민등록번호 암호화 저장 (기획 결정 108 / docs/20260831_PLAN_tax_module.md)
-- 원칙: 평문은 DB 어디에도 남기지 않는다. 테이블 직접 접근은 RLS 정책 0개로 전면 차단하고,
--       읽기·쓰기는 전부 SECURITY DEFINER RPC 를 통해서만. 전문(full) 반환은 지급명세서용 1개뿐이며 접근 로그 필수.
-- pgcrypto 는 extensions 스키마에 설치되어 있어(확인 완료) 함수 안에서는 스키마를 반드시 붙인다.

-- 1) Vault 키 (멱등) ---------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'employee_rrn_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'employee_rrn_key',
      '주민등록번호 암호화 키 — employee_rrn RPC 전용 (2026-08-31 결정 108)'
    );
  end if;
end $$;

-- 2) 테이블 -----------------------------------------------------------------
create table if not exists public.employee_rrn (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  rrn_enc     bytea not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
alter table public.employee_rrn enable row level security;
revoke all on public.employee_rrn from anon, authenticated;
-- 정책 0개 = deny all. 접근은 아래 SECURITY DEFINER RPC 로만.

create index if not exists employee_rrn_company_idx on public.employee_rrn (company_id);

create table if not exists public.employee_rrn_access_log (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null,
  user_id      uuid,
  action       text not null check (action in ('set','delete','get_statement')),
  employee_ids uuid[] not null default '{}',
  created_at   timestamptz not null default now()
);
alter table public.employee_rrn_access_log enable row level security;
revoke all on public.employee_rrn_access_log from anon, authenticated;
grant select on public.employee_rrn_access_log to authenticated;

create index if not exists employee_rrn_access_log_company_idx
  on public.employee_rrn_access_log (company_id, created_at desc);

-- 열람 이력은 같은 회사 마스터만 조회. insert/update/delete 정책 없음(definer 함수만 쓴다).
drop policy if exists rrn_log_select on public.employee_rrn_access_log;
create policy rrn_log_select on public.employee_rrn_access_log for select to authenticated
  using (
    company_id = (select u.company_id from public.users u where u.auth_id = auth.uid() limit 1)
    and exists (select 1 from public.users u where u.auth_id = auth.uid() and u.is_master)
  );

-- 3) RPC --------------------------------------------------------------------

-- 3-1) 저장/삭제 — 인사 담당(마스터 또는 '/employees')
create or replace function public.set_employee_rrn(p_employee uuid, p_rrn text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me      users%rowtype;
  v_company uuid;
  v_allowed boolean;
  v_clean   text;
  v_key     text;
begin
  select * into v_me from users where auth_id = auth.uid() limit 1;
  if v_me.id is null then return json_build_object('ok', false, 'error', '로그인이 필요합니다'); end if;

  select company_id into v_company from employees where id = p_employee;
  if v_company is null or v_company <> v_me.company_id then
    return json_build_object('ok', false, 'error', '같은 회사 구성원이 아닙니다');
  end if;

  v_allowed := v_me.is_master or exists (
    select 1 from member_permissions where user_id = v_me.id and perm_key = '/employees'
  );
  if not v_allowed then
    return json_build_object('ok', false, 'error', '주민등록번호를 등록할 권한이 없습니다 (인사관리 권한 필요)');
  end if;

  -- 빈 값 = 삭제
  if p_rrn is null or btrim(p_rrn) = '' then
    delete from employee_rrn where employee_id = p_employee;
    insert into employee_rrn_access_log (company_id, user_id, action, employee_ids)
    values (v_me.company_id, v_me.id, 'delete', array[p_employee]);
    return json_build_object('ok', true, 'deleted', true);
  end if;

  v_clean := regexp_replace(p_rrn, '[-[:space:]]', '', 'g');
  -- 주민 13자리 숫자 + 외국인등록번호·여권번호(영문 포함)까지 허용. 실패 메시지에 값은 절대 넣지 않는다.
  if v_clean !~ '^[A-Za-z0-9]{5,13}$' then
    return json_build_object('ok', false, 'error', '형식이 올바르지 않습니다 (숫자 13자리 또는 영문·숫자 5~13자)');
  end if;

  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'employee_rrn_key';
  if v_key is null then return json_build_object('ok', false, 'error', '암호화 키가 설정되지 않았습니다'); end if;

  insert into employee_rrn (employee_id, company_id, rrn_enc, updated_at, updated_by)
  values (p_employee, v_me.company_id, extensions.pgp_sym_encrypt(v_clean, v_key), now(), v_me.id)
  on conflict (employee_id) do update
    set rrn_enc    = excluded.rrn_enc,
        company_id = excluded.company_id,
        updated_at = now(),
        updated_by = excluded.updated_by;

  insert into employee_rrn_access_log (company_id, user_id, action, employee_ids)
  values (v_me.company_id, v_me.id, 'set', array[p_employee]);

  return json_build_object('ok', true);
exception when others then
  -- 예외 원문에 값이 섞이지 않도록 메시지를 고정
  return json_build_object('ok', false, 'error', '주민등록번호 저장에 실패했습니다');
end $function$;

-- 3-2) 마스킹 조회 — 화면 표시용(전문 아님) → 로그 없음
create or replace function public.get_employee_rrn_masked(p_employee uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me      users%rowtype;
  v_company uuid;
  v_allowed boolean;
  v_key     text;
  v_enc     bytea;
  v         text;
begin
  select * into v_me from users where auth_id = auth.uid() limit 1;
  if v_me.id is null then return null; end if;

  select company_id into v_company from employees where id = p_employee;
  if v_company is null or v_company <> v_me.company_id then return null; end if;

  v_allowed := v_me.is_master or exists (
    select 1 from member_permissions where user_id = v_me.id and perm_key = '/employees'
  );
  if not v_allowed then return null; end if;

  select rrn_enc into v_enc from employee_rrn where employee_id = p_employee and company_id = v_me.company_id;
  if v_enc is null then return null; end if;

  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'employee_rrn_key';
  if v_key is null then return null; end if;

  v := extensions.pgp_sym_decrypt(v_enc, v_key);
  if v is null then return null; end if;

  if length(v) >= 8 then
    return substr(v, 1, 6) || '-' || substr(v, 7, 1) || repeat('*', length(v) - 7);
  end if;
  return repeat('*', length(v));
exception when others then
  return null;
end $function$;

-- 3-3) 등록 여부 목록 — 값이 아니라 '등록됨' 표시용 → 로그 없음
create or replace function public.list_rrn_registered()
returns setof uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me      users%rowtype;
  v_allowed boolean;
begin
  select * into v_me from users where auth_id = auth.uid() limit 1;
  if v_me.id is null then return; end if;

  v_allowed := v_me.is_master or exists (
    select 1 from member_permissions
    where user_id = v_me.id and perm_key in ('/employees', '/finance/tax-filing')
  );
  if not v_allowed then return; end if;

  return query
    select employee_id from employee_rrn where company_id = v_me.company_id;
end $function$;

-- 3-4) 전문 반환 — 지급명세서 생성 전용. 반환 전 접근 로그 필수.
create or replace function public.get_rrns_for_statement(p_employee_ids uuid[])
returns table (employee_id uuid, rrn text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me      users%rowtype;
  v_allowed boolean;
  v_key     text;
  v_ids     uuid[];
begin
  select * into v_me from users where auth_id = auth.uid() limit 1;
  if v_me.id is null then return; end if;

  v_allowed := v_me.is_master or exists (
    select 1 from member_permissions where user_id = v_me.id and perm_key = '/finance/tax-filing'
  );
  if not v_allowed then return; end if;

  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'employee_rrn_key';
  if v_key is null then return; end if;

  select coalesce(array_agg(r.employee_id), '{}') into v_ids
  from employee_rrn r
  where r.company_id = v_me.company_id
    and r.employee_id = any (coalesce(p_employee_ids, '{}'::uuid[]));

  if coalesce(array_length(v_ids, 1), 0) = 0 then return; end if;

  insert into employee_rrn_access_log (company_id, user_id, action, employee_ids)
  values (v_me.company_id, v_me.id, 'get_statement', v_ids);

  return query
    select r.employee_id, extensions.pgp_sym_decrypt(r.rrn_enc, v_key)
    from employee_rrn r
    where r.employee_id = any (v_ids);
end $function$;

-- 4) 실행 권한 ---------------------------------------------------------------
revoke all on function public.set_employee_rrn(uuid, text) from public, anon;
revoke all on function public.get_employee_rrn_masked(uuid) from public, anon;
revoke all on function public.list_rrn_registered() from public, anon;
revoke all on function public.get_rrns_for_statement(uuid[]) from public, anon;

grant execute on function public.set_employee_rrn(uuid, text) to authenticated;
grant execute on function public.get_employee_rrn_masked(uuid) to authenticated;
grant execute on function public.list_rrn_registered() to authenticated;
grant execute on function public.get_rrns_for_statement(uuid[]) to authenticated;
