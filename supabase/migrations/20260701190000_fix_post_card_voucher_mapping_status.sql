-- 카드 전표처리 오류 수정 (2026-07-01)
--   post_card_voucher 가 card_transactions.mapping_status 를 'mapped' 로 UPDATE 했는데,
--   card_transactions_mapping_status_check 는 ('unmapped','auto_mapped','manual_mapped','ignored') 만 허용.
--   → CHECK 위반으로 전표 생성이 롤백되고 클라이언트에 에러 토스트가 뜨던 문제.
--   'mapped' → 'manual_mapped' 로 교정(그 외 로직 불변).

create or replace function public.post_card_voucher(p_card_tx_id uuid, p_account_id uuid, p_remember boolean default false)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company uuid := public.get_my_company_id();
  v_uid uuid;
  v_card record;
  v_cash uuid;
  v_entry uuid;
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  if not public.is_company_admin() then raise exception 'FORBIDDEN'; end if;

  select * into v_card from card_transactions where id = p_card_tx_id and company_id = v_company;
  if v_card.id is null then raise exception 'NOT_FOUND'; end if;
  if v_card.journal_entry_id is not null then raise exception 'ALREADY_POSTED'; end if;
  if v_card.amount is null or v_card.amount = 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_account_id is null or not exists (select 1 from chart_of_accounts a where a.id = p_account_id and a.company_id = v_company) then
    raise exception 'INVALID_ACCOUNT';
  end if;
  select id into v_cash from chart_of_accounts where company_id = v_company and code = '101';
  if v_cash is null then raise exception 'NO_CASH_ACCOUNT'; end if;

  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;

  insert into journal_entries (
    company_id, entry_date, description, source, status, is_approved, deal_id,
    voucher_type, voucher_no, created_by, approved_by, reviewed_by, reviewed_at
  ) values (
    v_company, v_card.transaction_date, coalesce(v_card.merchant_name, ''), 'manual', 'confirmed', true, v_card.deal_id,
    'cash_out',
    (select coalesce(max(voucher_no), 0) + 1 from journal_entries where company_id = v_company and entry_date = v_card.transaction_date),
    v_uid, v_uid, v_uid, now()
  ) returning id into v_entry;

  insert into journal_lines (entry_id, company_id, account_id, debit, credit, description)
  values
    (v_entry, v_company, p_account_id, v_card.amount, 0, coalesce(v_card.merchant_name, '')),
    (v_entry, v_company, v_cash, 0, v_card.amount, coalesce(v_card.merchant_name, ''));

  update card_transactions
    set journal_entry_id = v_entry, mapping_status = 'manual_mapped', mapped_by = v_uid, mapped_at = now()
    where id = p_card_tx_id;

  if p_remember and coalesce(v_card.category, '') <> '' then
    insert into card_account_mappings (company_id, category, account_id, updated_at)
    values (v_company, v_card.category, p_account_id, now())
    on conflict (company_id, category) do update set account_id = excluded.account_id, updated_at = now();
  end if;

  return v_entry;
end;
$function$;
