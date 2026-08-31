-- 주민등록번호 저장 보안 검수 후속 (2026-08-31, security-reviewer 지적 P1~P4)
-- 선행: 20260831150000_employee_rrn_encrypted.sql
--
-- P1 (파기 경로) — 검수 지적은 reset_company_data 의 삭제 목록에 employee_rrn 이 없다는 것이었으나,
--   그 함수는 2026-08-10 사장님 지시("데이터 초기화는 없애자, 회사 삭제만 놔둬")로
--   20260810170000_drop_reset_company_data.sql 에서 이미 삭제됐고 prod 에도 존재하지 않는다(pg_proc 확인).
--   되살리면 사장님이 없애라고 한 파괴적 RPC 를 부활시키는 것이므로 재생성하지 않는다.
--   현재 파기는 master_delete_company 가 맡고, 그 함수는 information_schema 에서
--   company_id 컬럼을 가진 public BASE TABLE 을 매번 동적으로 훑는다 →
--   employee_rrn·employee_rrn_access_log 는 둘 다 company_id 가 있어 자동 포함된다(별도 등록 불필요).
--   남는 위험은 과거에 FK 를 우회해 지워진 employees 의 고아 암호문뿐이라 여기서 한 번 청소한다.
delete from public.employee_rrn r
where not exists (select 1 from public.employees e where e.id = r.employee_id);

-- P3 + P4 — 함수 본문 변경(아래 재정의). P2 는 파일 끝에서 4종 전체에 일괄 적용.

-- P4) 마스킹 조회: 암호문이 있는데 복호화가 깨진 경우와 '미등록'을 구별한다.
--     행이 없으면 여전히 null, 복호화 실패 시에만 '!decrypt_error' 센티널.
create or replace function public.get_employee_rrn_masked(p_employee uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
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
  if v_enc is null then return null; end if;  -- 미등록

  -- 여기서부터는 암호문이 존재한다 → 실패는 전부 '복호화 오류'로 구별해 알린다.
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'employee_rrn_key';
  if v_key is null then return '!decrypt_error'; end if;

  begin
    v := extensions.pgp_sym_decrypt(v_enc, v_key);
  exception when others then
    return '!decrypt_error';  -- 예외 원문(값 포함 가능)을 밖으로 내보내지 않는다
  end;
  if v is null then return '!decrypt_error'; end if;

  if length(v) >= 8 then
    return substr(v, 1, 6) || '-' || substr(v, 7, 1) || repeat('*', length(v) - 7);
  end if;
  return repeat('*', length(v));
end $function$;

-- P3) 전문 반환(지급명세서 전용)에 배치 상한 500명. 메시지는 고정 문구 — 값·id 를 넣지 않는다.
create or replace function public.get_rrns_for_statement(p_employee_ids uuid[])
returns table (employee_id uuid, rrn text)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_me      users%rowtype;
  v_allowed boolean;
  v_key     text;
  v_ids     uuid[];
begin
  if coalesce(array_length(p_employee_ids, 1), 0) > 500 then
    raise exception '한 번에 500명까지만 조회할 수 있습니다';
  end if;

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

-- P2) search_path 를 저장소 표준(20260722180000_pin_function_search_path.sql)과 동일하게 public, pg_temp 로.
alter function public.set_employee_rrn(uuid, text)        set search_path = public, pg_temp;
alter function public.get_employee_rrn_masked(uuid)       set search_path = public, pg_temp;
alter function public.list_rrn_registered()               set search_path = public, pg_temp;
alter function public.get_rrns_for_statement(uuid[])      set search_path = public, pg_temp;

-- 재정의로 초기화됐을 수 있는 실행 권한 재확인 (멱등)
revoke all on function public.get_employee_rrn_masked(uuid) from public, anon;
revoke all on function public.get_rrns_for_statement(uuid[]) from public, anon;
grant execute on function public.get_employee_rrn_masked(uuid) to authenticated;
grant execute on function public.get_rrns_for_statement(uuid[]) to authenticated;
