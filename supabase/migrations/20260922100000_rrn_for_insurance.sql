-- 4대보험 취득·상실 신고 파일용 주민등록번호 조회 (2026-09-22, ERP 공백 2차 ⑤)
--   get_rrns_for_statement(지급명세서) 와 같은 몸통 — 다른 점 두 가지:
--   · 허용 권한: 마스터 · 급여(/employees:salary) · 세무 신고(/finance/tax-filing). 인력관리(/employees)만으로는 못 본다.
--   · 열람 기록 action = 'get_insurance' — 무엇 때문에 풀었는지 로그에서 갈라 보이게.
--   한 번에 500명(신고 파일 상한과 같다). 등록된 직원만 돌려주고, 미등록은 화면이 '(미등록)'으로 알린다.
create or replace function public.get_rrns_for_insurance(p_employee_ids uuid[])
returns table (employee_id uuid, rrn text)
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
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
    select 1 from member_permissions where user_id = v_me.id and perm_key in ('/employees:salary', '/finance/tax-filing')
  );
  if not v_allowed then return; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'employee_rrn_key';
  if v_key is null then return; end if;
  select coalesce(array_agg(r.employee_id), '{}') into v_ids
  from employee_rrn r
  where r.company_id = v_me.company_id and r.employee_id = any (coalesce(p_employee_ids, '{}'::uuid[]));
  if coalesce(array_length(v_ids, 1), 0) = 0 then return; end if;
  insert into employee_rrn_access_log (company_id, user_id, action, employee_ids)
  values (v_me.company_id, v_me.id, 'get_insurance', v_ids);
  return query
    select r.employee_id, extensions.pgp_sym_decrypt(r.rrn_enc, v_key)
    from employee_rrn r where r.employee_id = any (v_ids);
end $$;
revoke all on function public.get_rrns_for_insurance(uuid[]) from public, anon;
grant execute on function public.get_rrns_for_insurance(uuid[]) to authenticated;
