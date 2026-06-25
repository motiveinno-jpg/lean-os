-- 거래내역 일괄 전표처리 — 통장/현금영수증/세금계산서 (2026-06-25)
--   카드 post_card_voucher(20260617170000) 패턴 복제. journal_entries + journal_lines 생성,
--   원본행.journal_entry_id 세팅, security definer, 가드 동일.
--   계정코드: 101 보통예금 / 108 외상매출금(AR) / 251 외상매입금(AP) / 136 부가세대급금 / 255 부가세예수금.
--   함수 본문 ASCII (한글 인코딩 손상 방지).

-- 1) 링크 컬럼
alter table public.bank_transactions add column if not exists journal_entry_id uuid references public.journal_entries(id) on delete set null;
alter table public.cash_receipts     add column if not exists journal_entry_id uuid references public.journal_entries(id) on delete set null;
alter table public.tax_invoices      add column if not exists journal_entry_id uuid references public.journal_entries(id) on delete set null;

-- 공통 가드 헬퍼는 인라인 (카드 RPC 와 동일 패턴)

-- 2) 현금영수증 1건 -> 전표 (비용 지출): 차)선택계정 net [+차)136 vat] / 대)101 total
create or replace function public.post_cash_voucher(p_cash_receipt_id uuid, p_account_id uuid, p_remember boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.get_my_company_id();
  v_uid uuid; v_r record; v_cash uuid; v_vatin uuid; v_entry uuid;
  v_total numeric; v_net numeric; v_vat numeric;
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  if not public.is_company_admin() then raise exception 'FORBIDDEN'; end if;
  select * into v_r from cash_receipts where id = p_cash_receipt_id and company_id = v_company;
  if v_r.id is null then raise exception 'NOT_FOUND'; end if;
  if v_r.journal_entry_id is not null then raise exception 'ALREADY_POSTED'; end if;
  v_total := coalesce(v_r.amount, v_r.supply_amount);
  v_net := coalesce(v_r.supply_amount, v_r.amount);
  if v_total is null or v_total = 0 then raise exception 'INVALID_AMOUNT'; end if;
  v_vat := greatest(coalesce(v_total,0) - coalesce(v_net,0), 0);
  if p_account_id is null or not exists (select 1 from chart_of_accounts a where a.id = p_account_id and a.company_id = v_company) then raise exception 'INVALID_ACCOUNT'; end if;
  select id into v_cash from chart_of_accounts where company_id = v_company and code = '101';
  if v_cash is null then raise exception 'NO_CASH_ACCOUNT'; end if;
  select id into v_vatin from chart_of_accounts where company_id = v_company and code = '136';
  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;

  insert into journal_entries (company_id, entry_date, description, source, status, is_approved, deal_id, voucher_type, voucher_no, created_by, approved_by, reviewed_by, reviewed_at)
  values (v_company, v_r.issue_date, coalesce(v_r.counterparty_name, ''), 'manual', 'confirmed', true, v_r.deal_id, 'cash_out',
    (select coalesce(max(voucher_no), 0) + 1 from journal_entries where company_id = v_company and entry_date = v_r.issue_date),
    v_uid, v_uid, v_uid, now()) returning id into v_entry;

  if v_vat > 0 and v_vatin is not null then
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description) values
      (v_entry, v_company, p_account_id, v_net, 0, coalesce(v_r.counterparty_name, '')),
      (v_entry, v_company, v_vatin, v_vat, 0, 'VAT'),
      (v_entry, v_company, v_cash, 0, v_total, coalesce(v_r.counterparty_name, ''));
  else
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description) values
      (v_entry, v_company, p_account_id, v_total, 0, coalesce(v_r.counterparty_name, '')),
      (v_entry, v_company, v_cash, 0, v_total, coalesce(v_r.counterparty_name, ''));
  end if;

  update cash_receipts set journal_entry_id = v_entry where id = p_cash_receipt_id;
  return v_entry;
end; $$;
grant execute on function public.post_cash_voucher(uuid, uuid, boolean) to authenticated;

-- 3) 통장 1건 -> 전표 (방향 분기): 출금=차)선택 / 대)101, 입금=차)101 / 대)선택
create or replace function public.post_bank_voucher(p_bank_tx_id uuid, p_account_id uuid, p_remember boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.get_my_company_id();
  v_uid uuid; v_tx record; v_cash uuid; v_entry uuid;
  v_amt numeric; v_is_in boolean;
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  if not public.is_company_admin() then raise exception 'FORBIDDEN'; end if;
  select * into v_tx from bank_transactions where id = p_bank_tx_id and company_id = v_company;
  if v_tx.id is null then raise exception 'NOT_FOUND'; end if;
  if v_tx.journal_entry_id is not null then raise exception 'ALREADY_POSTED'; end if;
  v_amt := abs(coalesce(v_tx.amount, 0));
  if v_amt = 0 then raise exception 'INVALID_AMOUNT'; end if;
  v_is_in := (v_tx.type in ('income', 'deposit', 'in')) or (coalesce(v_tx.amount,0) > 0 and v_tx.type is null);
  if p_account_id is null or not exists (select 1 from chart_of_accounts a where a.id = p_account_id and a.company_id = v_company) then raise exception 'INVALID_ACCOUNT'; end if;
  select id into v_cash from chart_of_accounts where company_id = v_company and code = '101';
  if v_cash is null then raise exception 'NO_CASH_ACCOUNT'; end if;
  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;

  insert into journal_entries (company_id, entry_date, description, source, status, is_approved, deal_id, voucher_type, voucher_no, created_by, approved_by, reviewed_by, reviewed_at)
  values (v_company, v_tx.transaction_date, coalesce(v_tx.counterparty, v_tx.description, ''), 'manual', 'confirmed', true, v_tx.deal_id,
    case when v_is_in then 'cash_in' else 'cash_out' end,
    (select coalesce(max(voucher_no), 0) + 1 from journal_entries where company_id = v_company and entry_date = v_tx.transaction_date),
    v_uid, v_uid, v_uid, now()) returning id into v_entry;

  if v_is_in then
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description) values
      (v_entry, v_company, v_cash, v_amt, 0, coalesce(v_tx.counterparty, '')),
      (v_entry, v_company, p_account_id, 0, v_amt, coalesce(v_tx.counterparty, ''));
  else
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description) values
      (v_entry, v_company, p_account_id, v_amt, 0, coalesce(v_tx.counterparty, '')),
      (v_entry, v_company, v_cash, 0, v_amt, coalesce(v_tx.counterparty, ''));
  end if;

  update bank_transactions set journal_entry_id = v_entry where id = p_bank_tx_id;
  return v_entry;
end; $$;
grant execute on function public.post_bank_voucher(uuid, uuid, boolean) to authenticated;

-- 4) 세금계산서 1건 -> 전표 (매출/매입 + VAT 분리)
--    매입: 차)선택 supply + 차)136 vat / 대)251 total. 매출: 차)108 total / 대)선택 supply + 대)255 vat.
create or replace function public.post_invoice_voucher(p_tax_invoice_id uuid, p_account_id uuid, p_remember boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.get_my_company_id();
  v_uid uuid; v_inv record; v_entry uuid;
  v_ap uuid; v_ar uuid; v_vatin uuid; v_vatout uuid;
  v_supply numeric; v_tax numeric; v_total numeric; v_is_sales boolean;
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  if not public.is_company_admin() then raise exception 'FORBIDDEN'; end if;
  select * into v_inv from tax_invoices where id = p_tax_invoice_id and company_id = v_company;
  if v_inv.id is null then raise exception 'NOT_FOUND'; end if;
  if v_inv.journal_entry_id is not null then raise exception 'ALREADY_POSTED'; end if;
  v_supply := coalesce(v_inv.supply_amount, 0);
  v_tax := coalesce(v_inv.tax_amount, 0);
  v_total := coalesce(v_inv.total_amount, v_supply + v_tax);
  if v_total = 0 then raise exception 'INVALID_AMOUNT'; end if;
  v_is_sales := (v_inv.type in ('sales', '매출'));
  if p_account_id is null or not exists (select 1 from chart_of_accounts a where a.id = p_account_id and a.company_id = v_company) then raise exception 'INVALID_ACCOUNT'; end if;
  select id into v_ar from chart_of_accounts where company_id = v_company and code = '108';
  select id into v_ap from chart_of_accounts where company_id = v_company and code = '251';
  select id into v_vatin from chart_of_accounts where company_id = v_company and code = '136';
  select id into v_vatout from chart_of_accounts where company_id = v_company and code = '255';
  if v_is_sales and v_ar is null then raise exception 'INVALID_ACCOUNT'; end if;
  if (not v_is_sales) and v_ap is null then raise exception 'INVALID_ACCOUNT'; end if;
  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;

  insert into journal_entries (company_id, entry_date, description, source, status, is_approved, deal_id, voucher_type, voucher_no, created_by, approved_by, reviewed_by, reviewed_at)
  values (v_company, v_inv.issue_date, coalesce(v_inv.counterparty_name, ''), 'manual', 'confirmed', true, v_inv.deal_id,
    case when v_is_sales then 'cash_in' else 'cash_out' end,
    (select coalesce(max(voucher_no), 0) + 1 from journal_entries where company_id = v_company and entry_date = v_inv.issue_date),
    v_uid, v_uid, v_uid, now()) returning id into v_entry;

  if v_is_sales then
    -- 차)외상매출금 total / 대)선택(매출) supply + 대)부가세예수금 vat
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description) values
      (v_entry, v_company, v_ar, v_total, 0, coalesce(v_inv.counterparty_name, '')),
      (v_entry, v_company, p_account_id, 0, v_supply, coalesce(v_inv.counterparty_name, ''));
    if v_tax > 0 and v_vatout is not null then
      insert into journal_lines (entry_id, company_id, account_id, debit, credit, description)
      values (v_entry, v_company, v_vatout, 0, v_tax, 'VAT');
    end if;
  else
    -- 차)선택(비용) supply + 차)부가세대급금 vat / 대)외상매입금 total
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description) values
      (v_entry, v_company, p_account_id, v_supply, 0, coalesce(v_inv.counterparty_name, '')),
      (v_entry, v_company, v_ap, 0, v_total, coalesce(v_inv.counterparty_name, ''));
    if v_tax > 0 and v_vatin is not null then
      insert into journal_lines (entry_id, company_id, account_id, debit, credit, description)
      values (v_entry, v_company, v_vatin, v_tax, 0, 'VAT');
    end if;
  end if;

  update tax_invoices set journal_entry_id = v_entry where id = p_tax_invoice_id;
  return v_entry;
end; $$;
grant execute on function public.post_invoice_voucher(uuid, uuid, boolean) to authenticated;
