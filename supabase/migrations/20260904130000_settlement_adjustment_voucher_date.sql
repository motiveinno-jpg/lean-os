-- 정산 조정 전표(잔돈·원천징수 자동 마감)의 날짜를 실제 입출금일로.
--   조정행은 bank_transaction_id 가 없어 전표 날짜가 created_at(만든 날)로 찍혀 월별 손익이 어긋났다.
--   같은 계산서의 확정 정산 중 가장 최근 통장 거래일을 쓰고, 없으면 종전대로 만든 날.
SET statement_timeout = '60000';

CREATE OR REPLACE FUNCTION public.post_settlement_voucher()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_company uuid := new.company_id;
  v_uid uuid;
  v_invtype text; v_cpname text; v_pid uuid;
  v_txdate date; v_edate date; v_bank_amt numeric;
  v_acct_cash uuid; v_acct_ar uuid; v_acct_ap uuid;
  v_acct_prepaid_tax uuid; v_acct_fee uuid; v_acct_misc_loss uuid; v_acct_misc_gain uuid;
  v_debit_acct uuid; v_credit_acct uuid; v_entry_id uuid;
  v_diff numeric := 0; v_use_diff boolean := false; v_n_real int;
begin
  if new.amount is null or new.amount <= 0 then return null; end if;
  if exists (select 1 from journal_entries je where je.linked_settlement_id = new.id and je.status <> 'rejected') then return null; end if;

  --   ★ 같은 계산서·같은 입출금 줄에 살아 있는 전표가 이미 있으면 또 만들지 않는다 (2026-08-12)
  if new.match_type <> 'adjustment' and new.bank_transaction_id is not null and exists (
       select 1 from journal_entries je
       where je.company_id = v_company
         and je.reference_type = 'settlement'
         and je.linked_invoice_id = new.tax_invoice_id
         and je.linked_bank_tx_id = new.bank_transaction_id
         and je.status <> 'rejected'
         and coalesce(je.reason, '') not like '%/adjustment %'
     ) then return null; end if;

  select i.type, i.counterparty_name, i.partner_id into v_invtype, v_cpname, v_pid from tax_invoices i where i.id = new.tax_invoice_id;
  if v_invtype is null then return null; end if;

  select b.transaction_date, b.amount into v_txdate, v_bank_amt from bank_transactions b where b.id = new.bank_transaction_id;
  -- 조정행(잔돈·원천징수 마감)은 통장 줄이 없어 종전엔 '만든 날'로 찍혔다 → 같은 계산서의 실제 정산(입출금) 날짜를 쓴다.
  if v_txdate is null and new.match_type = 'adjustment' then
    select b.transaction_date into v_txdate
    from invoice_settlements s join bank_transactions b on b.id = s.bank_transaction_id
    where s.tax_invoice_id = new.tax_invoice_id and s.status = 'confirmed' and s.match_type <> 'adjustment' and s.id <> new.id
    order by b.transaction_date desc limit 1;
  end if;
  v_edate := coalesce(v_txdate, new.created_at::date);
  if exists (select 1 from closing_checklists cc where cc.company_id = v_company and cc.month = to_char(v_edate, 'YYYY-MM') and cc.status = 'locked') then return null; end if;

  select id into v_acct_cash from chart_of_accounts where company_id = v_company and code = '103';
  select id into v_acct_ar from chart_of_accounts where company_id = v_company and code = '108';
  select id into v_acct_ap from chart_of_accounts where company_id = v_company and code = '251';
  select id into v_acct_prepaid_tax from chart_of_accounts where company_id = v_company and code = '136';
  select id into v_acct_fee from chart_of_accounts where company_id = v_company and code = '831';
  select id into v_acct_misc_loss from chart_of_accounts where company_id = v_company and code = '960';
  select id into v_acct_misc_gain from chart_of_accounts where company_id = v_company and code = '930';
  if v_acct_cash is null or v_acct_ar is null or v_acct_ap is null then return null; end if;

  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;

  if new.match_type <> 'adjustment' and new.bank_transaction_id is not null and v_bank_amt is not null and v_bank_amt > 0 then
    v_diff := v_bank_amt - new.amount;
    select count(*) into v_n_real from invoice_settlements s2
      where s2.bank_transaction_id = new.bank_transaction_id and s2.status = 'confirmed' and s2.match_type <> 'adjustment';
    if v_diff <> 0 and abs(v_diff) <= 200000 and v_n_real = 1 and v_acct_misc_loss is not null and v_acct_misc_gain is not null then
      v_use_diff := true;
    end if;
  end if;

  insert into journal_entries (
    company_id, entry_date, description, source, status, is_approved, confidence, reason,
    linked_invoice_id, linked_bank_tx_id, linked_settlement_id, reference_type, reference_id,
    created_by, approved_by, reviewed_by, reviewed_at
  ) values (
    v_company, v_edate, coalesce(v_cpname, ''), 'rule', 'confirmed', true, coalesce(new.confidence, 1),
    format('settlement=%s | %s/%s | settled=%s | bank=%s', new.id, v_invtype, new.match_type, new.amount, coalesce(v_bank_amt::text, '-')),
    new.tax_invoice_id, new.bank_transaction_id, new.id, 'settlement', new.id,
    v_uid, v_uid, v_uid, now()
  ) returning id into v_entry_id;

  if new.match_type = 'adjustment' then
    if v_invtype = 'sales' then
      v_debit_acct := case new.adjustment_reason
        when 'withholding_tax' then coalesce(v_acct_prepaid_tax, v_acct_misc_loss)
        when 'fee' then coalesce(v_acct_fee, v_acct_misc_loss)
        else v_acct_misc_loss end;
      v_credit_acct := v_acct_ar;
    else
      v_debit_acct := v_acct_ap; v_credit_acct := coalesce(v_acct_misc_gain, v_acct_misc_loss);
    end if;
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, partner_id)
      values (v_entry_id, v_company, v_debit_acct, new.amount, 0, v_pid),
             (v_entry_id, v_company, v_credit_acct, 0, new.amount, v_pid);

  elsif v_use_diff and v_invtype <> 'sales' then
    -- 매입(출금): (차)외상매입금[계산서] + 차액(잡손실/잡이익) / (대)보통예금[실제출금]
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, partner_id)
      values (v_entry_id, v_company, v_acct_ap, new.amount, 0, v_pid);
    if v_diff > 0 then
      insert into journal_lines (entry_id, company_id, account_id, debit, credit) values (v_entry_id, v_company, v_acct_misc_loss, v_diff, 0);
    else
      insert into journal_lines (entry_id, company_id, account_id, debit, credit) values (v_entry_id, v_company, v_acct_misc_gain, 0, -v_diff);
    end if;
    insert into journal_lines (entry_id, company_id, account_id, debit, credit) values (v_entry_id, v_company, v_acct_cash, 0, v_bank_amt);

  elsif v_use_diff and v_invtype = 'sales' then
    -- 매출(입금): (차)보통예금[실제입금] + 차액 / (대)외상매출금[계산서]
    insert into journal_lines (entry_id, company_id, account_id, debit, credit) values (v_entry_id, v_company, v_acct_cash, v_bank_amt, 0);
    if v_diff > 0 then
      insert into journal_lines (entry_id, company_id, account_id, debit, credit) values (v_entry_id, v_company, v_acct_misc_gain, 0, v_diff);
    else
      insert into journal_lines (entry_id, company_id, account_id, debit, credit) values (v_entry_id, v_company, v_acct_misc_loss, -v_diff, 0);
    end if;
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, partner_id) values (v_entry_id, v_company, v_acct_ar, 0, new.amount, v_pid);

  else
    if v_invtype = 'sales' then v_debit_acct := v_acct_cash; v_credit_acct := v_acct_ar;
    else v_debit_acct := v_acct_ap; v_credit_acct := v_acct_cash; end if;
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, partner_id)
      values (v_entry_id, v_company, v_debit_acct, new.amount, 0, v_pid),
             (v_entry_id, v_company, v_credit_acct, 0, new.amount, v_pid);
  end if;

  if v_use_diff then
    update bank_transactions set settled_amount = v_bank_amt, settlement_status = 'settled' where id = new.bank_transaction_id;
  end if;

  return null;
end;
$function$
;
