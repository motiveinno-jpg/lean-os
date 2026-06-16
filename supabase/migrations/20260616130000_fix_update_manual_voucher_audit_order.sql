-- update_manual_voucher 버그 수정 (2026-06-16)
--   audit 스냅샷이 order by jl.created_at 를 참조하나 journal_lines 에는 created_at 컬럼이 없음 →
--   저장 시 런타임 'column jl.created_at does not exist' 에러. order by jl.id 로 교체.
--   (source<>'manual' 안전판은 유지)
create or replace function public.update_manual_voucher(p_entry_id uuid, p_description text, p_lines jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company uuid := public.get_my_company_id();
  v_uid uuid;
  v_e record;
  v_line jsonb;
  v_debit numeric := 0;
  v_credit numeric := 0;
  v_d numeric; v_c numeric;
  v_acct uuid;
  v_before jsonb;
begin
  if v_company is null then
    raise exception 'NO_COMPANY';
  end if;
  if not public.is_company_admin() then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_e from journal_entries where id = p_entry_id and company_id = v_company;
  if v_e.id is null then
    raise exception 'NOT_FOUND';
  end if;
  if v_e.source <> 'manual' then
    raise exception 'NOT_MANUAL';  -- collected/auto (rule,ai) vouchers are not editable
  end if;
  if v_e.status <> 'confirmed' then
    raise exception 'NOT_FOUND_OR_INVALID';
  end if;

  -- hard guard: locked accounting period
  if exists (
    select 1 from closing_checklists cc
    where cc.company_id = v_company
      and cc.month = to_char(v_e.entry_date, 'YYYY-MM')
      and cc.status = 'locked'
  ) then
    raise exception 'PERIOD_LOCKED';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) < 2 then
    raise exception 'NEED_TWO_LINES';
  end if;

  -- validate lines + totals (one side per line, account must belong to company)
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_d := coalesce((v_line->>'debit')::numeric, 0);
    v_c := coalesce((v_line->>'credit')::numeric, 0);
    if v_d < 0 or v_c < 0 or (v_d > 0 and v_c > 0) or (v_d = 0 and v_c = 0) then
      raise exception 'INVALID_LINE_AMOUNT';
    end if;
    v_acct := (v_line->>'account_id')::uuid;
    if v_acct is null or not exists (select 1 from chart_of_accounts a where a.id = v_acct and a.company_id = v_company) then
      raise exception 'INVALID_ACCOUNT';
    end if;
    v_debit := v_debit + v_d;
    v_credit := v_credit + v_c;
  end loop;
  if v_debit <= 0 or v_debit <> v_credit then
    raise exception 'UNBALANCED';
  end if;

  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;

  -- audit: snapshot before-state (header description + all lines). order by id (created_at 컬럼 없음)
  select jsonb_build_object(
    'description', v_e.description,
    'lines', coalesce(jsonb_agg(jsonb_build_object(
      'account_id', jl.account_id, 'debit', jl.debit, 'credit', jl.credit,
      'partner_id', jl.partner_id, 'memo', jl.description
    ) order by jl.id), '[]'::jsonb)
  ) into v_before
  from journal_lines jl where jl.entry_id = p_entry_id;

  insert into journal_entry_audits (company_id, entry_id, action, actor_id, before)
  values (v_company, p_entry_id, 'update', v_uid, v_before);

  -- replace lines
  delete from journal_lines where entry_id = p_entry_id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id)
    values (
      p_entry_id, v_company,
      (v_line->>'account_id')::uuid,
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      coalesce(v_line->>'memo', ''),
      nullif(v_line->>'partner_id', '')::uuid
    );
  end loop;

  update journal_entries
  set description = coalesce(p_description, description),
      reviewed_by = v_uid, reviewed_at = now(), updated_at = now()
  where id = p_entry_id;
end;
$function$;
