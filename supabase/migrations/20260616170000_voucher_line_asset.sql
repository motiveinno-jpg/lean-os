-- 전표 라인에 자산관리 통장/카드 연결 (2026-06-16 거래처원장 핸드오프)
--   거래처(partner) 외에 회사 소유 통장(bank_accounts)·카드(corporate_cards)를 라인에 직접 연결.
--   journal_lines 에 nullable FK 2개 추가 + save/update_manual_voucher 가 jsonb 라인에서 받아 저장.
--   회사 소유 검증(INVALID_BANK_ACCOUNT / INVALID_CARD) 포함. partner_id 와 상호 배타가 아니라 병존 가능.

alter table public.journal_lines
  add column if not exists bank_account_id uuid references public.bank_accounts(id) on delete set null,
  add column if not exists card_id uuid references public.corporate_cards(id) on delete set null;

-- ── save_manual_voucher: 라인 insert 에 bank_account_id/card_id 추가 + 자산 소유 검증 ──
create or replace function public.save_manual_voucher(
  p_entry_date date,
  p_voucher_type text,
  p_description text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := public.get_my_company_id();
  v_uid uuid;
  v_entry_id uuid;
  v_no integer;
  v_line jsonb;
  v_debit numeric := 0;
  v_credit numeric := 0;
  v_d numeric; v_c numeric;
  v_acct uuid;
begin
  if v_company is null then
    raise exception 'NO_COMPANY';
  end if;
  if not public.is_company_admin() then
    raise exception 'FORBIDDEN';
  end if;
  if p_voucher_type is null or p_voucher_type not in ('cash_out','cash_in','transfer') then
    raise exception 'INVALID_TYPE';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) < 2 then
    raise exception 'NEED_TWO_LINES';
  end if;

  -- hard guard: locked accounting period
  if exists (
    select 1 from closing_checklists cc
    where cc.company_id = v_company
      and cc.month = to_char(p_entry_date, 'YYYY-MM')
      and cc.status = 'locked'
  ) then
    raise exception 'PERIOD_LOCKED';
  end if;

  -- validate lines + totals (one side per line, account/asset must belong to company)
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
    if coalesce(v_line->>'bank_account_id', '') <> ''
       and not exists (select 1 from bank_accounts b where b.id = (v_line->>'bank_account_id')::uuid and b.company_id = v_company) then
      raise exception 'INVALID_BANK_ACCOUNT';
    end if;
    if coalesce(v_line->>'card_id', '') <> ''
       and not exists (select 1 from corporate_cards c where c.id = (v_line->>'card_id')::uuid and c.company_id = v_company) then
      raise exception 'INVALID_CARD';
    end if;
    v_debit := v_debit + v_d;
    v_credit := v_credit + v_c;
  end loop;
  if v_debit <= 0 or v_debit <> v_credit then
    raise exception 'UNBALANCED';
  end if;

  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;
  select coalesce(max(voucher_no), 0) + 1 into v_no
  from journal_entries where company_id = v_company and entry_date = p_entry_date;

  insert into journal_entries (
    company_id, entry_date, description, source, status, is_approved,
    voucher_no, voucher_type, created_by, approved_by, reviewed_by, reviewed_at
  ) values (
    v_company, p_entry_date, coalesce(p_description, ''), 'manual', 'confirmed', true,
    v_no, p_voucher_type, v_uid, v_uid, v_uid, now()
  ) returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id, bank_account_id, card_id)
    values (
      v_entry_id, v_company,
      (v_line->>'account_id')::uuid,
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      coalesce(v_line->>'memo', ''),
      nullif(v_line->>'partner_id', '')::uuid,
      nullif(v_line->>'bank_account_id', '')::uuid,
      nullif(v_line->>'card_id', '')::uuid
    );
  end loop;

  return v_entry_id;
end;
$$;

grant execute on function public.save_manual_voucher(date, text, text, jsonb) to authenticated;

-- ── update_manual_voucher (일자 변경판, 20260616160000 기준): 자산 연결 추가 ──
drop function if exists public.update_manual_voucher(uuid, date, text, jsonb);
create or replace function public.update_manual_voucher(
  p_entry_id uuid,
  p_entry_date date,
  p_description text,
  p_lines jsonb
)
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
  if p_entry_date is null then
    raise exception 'NO_DATE';
  end if;

  select * into v_e from journal_entries where id = p_entry_id and company_id = v_company;
  if v_e.id is null then
    raise exception 'NOT_FOUND';
  end if;
  if v_e.source <> 'manual' then
    raise exception 'NOT_MANUAL';
  end if;
  if v_e.status <> 'confirmed' then
    raise exception 'NOT_FOUND_OR_INVALID';
  end if;

  -- hard guard: locked accounting period (old month OR new month)
  if exists (
    select 1 from closing_checklists cc
    where cc.company_id = v_company
      and cc.month in (to_char(v_e.entry_date, 'YYYY-MM'), to_char(p_entry_date, 'YYYY-MM'))
      and cc.status = 'locked'
  ) then
    raise exception 'PERIOD_LOCKED';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) < 2 then
    raise exception 'NEED_TWO_LINES';
  end if;

  -- validate lines + totals (one side per line, account/asset must belong to company)
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
    if coalesce(v_line->>'bank_account_id', '') <> ''
       and not exists (select 1 from bank_accounts b where b.id = (v_line->>'bank_account_id')::uuid and b.company_id = v_company) then
      raise exception 'INVALID_BANK_ACCOUNT';
    end if;
    if coalesce(v_line->>'card_id', '') <> ''
       and not exists (select 1 from corporate_cards c where c.id = (v_line->>'card_id')::uuid and c.company_id = v_company) then
      raise exception 'INVALID_CARD';
    end if;
    v_debit := v_debit + v_d;
    v_credit := v_credit + v_c;
  end loop;
  if v_debit <= 0 or v_debit <> v_credit then
    raise exception 'UNBALANCED';
  end if;

  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;

  -- audit: snapshot before-state (header description + entry_date + all lines)
  select jsonb_build_object(
    'entry_date', v_e.entry_date,
    'description', v_e.description,
    'lines', coalesce(jsonb_agg(jsonb_build_object(
      'account_id', jl.account_id, 'debit', jl.debit, 'credit', jl.credit,
      'partner_id', jl.partner_id, 'bank_account_id', jl.bank_account_id, 'card_id', jl.card_id, 'memo', jl.description
    ) order by jl.id), '[]'::jsonb)
  ) into v_before
  from journal_lines jl where jl.entry_id = p_entry_id;

  insert into journal_entry_audits (company_id, entry_id, action, actor_id, before)
  values (v_company, p_entry_id, 'update', v_uid, v_before);

  -- replace lines
  delete from journal_lines where entry_id = p_entry_id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id, bank_account_id, card_id)
    values (
      p_entry_id, v_company,
      (v_line->>'account_id')::uuid,
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      coalesce(v_line->>'memo', ''),
      nullif(v_line->>'partner_id', '')::uuid,
      nullif(v_line->>'bank_account_id', '')::uuid,
      nullif(v_line->>'card_id', '')::uuid
    );
  end loop;

  update journal_entries
  set entry_date = p_entry_date,
      description = coalesce(p_description, description),
      reviewed_by = v_uid, reviewed_at = now(), updated_at = now()
  where id = p_entry_id;
end;
$function$;

grant execute on function public.update_manual_voucher(uuid, date, text, jsonb) to authenticated;
