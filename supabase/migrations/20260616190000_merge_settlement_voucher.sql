-- 확인 큐 + AI 전표 통합 (B안, 2026-06-16 거래처원장 핸드오프)
--   사장님 UX: "이 입금이 이 계산서랑 맞다"(정산)와 "그걸 분개로 장부에 올린다"(전표)가
--   한 동작인데 탭이 둘로 쪼개져 혼란 → 정산 '확정' 한 번에 전표까지 자동 기장(취소 시 자동 무효).
--   1) post 트리거: 정산 confirmed → 분개 전표 자동 생성+기장(generate_voucher_drafts 매핑 미러).
--   2) void 트리거: 정산 confirmed 해제 → 연결 전표 자동 rejected(무효).
--   3) 백필: 기존 확정 정산의 미기장 초안(ai_suggested)을 기장(confirmed)으로 승계.
--   함수 본문은 한글 인코딩 손상 방지 위해 ASCII 만 사용.

-- ── 1. 정산 확정 시 전표 자동 기장 ──
create or replace function public.post_settlement_voucher()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := new.company_id;
  v_uid uuid;
  v_invtype text; v_cpname text; v_pid uuid;
  v_txdate date; v_edate date;
  v_acct_cash uuid; v_acct_ar uuid; v_acct_ap uuid;
  v_acct_prepaid_tax uuid; v_acct_fee uuid; v_acct_misc_loss uuid; v_acct_misc_gain uuid;
  v_debit_acct uuid; v_credit_acct uuid; v_entry_id uuid;
begin
  if new.amount is null or new.amount <= 0 then return null; end if;

  -- already has a live voucher for this settlement -> skip (no duplicate)
  if exists (select 1 from journal_entries je where je.linked_settlement_id = new.id and je.status <> 'rejected') then
    return null;
  end if;

  select i.type, i.counterparty_name, i.partner_id into v_invtype, v_cpname, v_pid
    from tax_invoices i where i.id = new.tax_invoice_id;
  if v_invtype is null then return null; end if;

  select b.transaction_date into v_txdate from bank_transactions b where b.id = new.bank_transaction_id;
  v_edate := coalesce(v_txdate, new.created_at::date);

  -- never post into a locked accounting period
  if exists (select 1 from closing_checklists cc where cc.company_id = v_company
       and cc.month = to_char(v_edate, 'YYYY-MM') and cc.status = 'locked') then
    return null;
  end if;

  select id into v_acct_cash from chart_of_accounts where company_id = v_company and code = '101';
  select id into v_acct_ar from chart_of_accounts where company_id = v_company and code = '108';
  select id into v_acct_ap from chart_of_accounts where company_id = v_company and code = '251';
  select id into v_acct_prepaid_tax from chart_of_accounts where company_id = v_company and code = '136';
  select id into v_acct_fee from chart_of_accounts where company_id = v_company and code = '831';
  select id into v_acct_misc_loss from chart_of_accounts where company_id = v_company and code = '980';
  select id into v_acct_misc_gain from chart_of_accounts where company_id = v_company and code = '901';
  if v_acct_cash is null or v_acct_ar is null or v_acct_ap is null then return null; end if;

  -- mapping mirrors generate_voucher_drafts
  if new.match_type = 'adjustment' then
    if v_invtype = 'sales' then
      v_debit_acct := case new.adjustment_reason
        when 'withholding_tax' then coalesce(v_acct_prepaid_tax, v_acct_misc_loss)
        when 'fee' then coalesce(v_acct_fee, v_acct_misc_loss)
        else v_acct_misc_loss end;
      v_credit_acct := v_acct_ar;
    else
      v_debit_acct := v_acct_ap;
      v_credit_acct := coalesce(v_acct_misc_gain, v_acct_misc_loss);
    end if;
  elsif v_invtype = 'sales' then
    v_debit_acct := v_acct_cash; v_credit_acct := v_acct_ar;
  else
    v_debit_acct := v_acct_ap; v_credit_acct := v_acct_cash;
  end if;

  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;

  insert into journal_entries (
    company_id, entry_date, description, source, status, is_approved, confidence, reason,
    linked_invoice_id, linked_bank_tx_id, linked_settlement_id, reference_type, reference_id,
    created_by, approved_by, reviewed_by, reviewed_at
  ) values (
    v_company, v_edate, coalesce(v_cpname, ''), 'rule', 'confirmed', true, coalesce(new.confidence, 1),
    format('settlement=%s | %s/%s | settled=%s', new.id, v_invtype, new.match_type, new.amount),
    new.tax_invoice_id, new.bank_transaction_id, new.id, 'settlement', new.id,
    v_uid, v_uid, v_uid, now()
  ) returning id into v_entry_id;

  insert into journal_lines (entry_id, company_id, account_id, debit, credit, partner_id)
  values
    (v_entry_id, v_company, v_debit_acct, new.amount, 0, v_pid),
    (v_entry_id, v_company, v_credit_acct, 0, new.amount, v_pid);

  return null;
end;
$$;

drop trigger if exists trg_settlement_post_voucher on public.invoice_settlements;
create trigger trg_settlement_post_voucher
  after insert or update on public.invoice_settlements
  for each row when (new.status = 'confirmed')
  execute function public.post_settlement_voucher();

-- ── 2. 정산 확정 해제 시 전표 자동 무효 ──
create or replace function public.void_settlement_voucher()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update journal_entries je
    set status = 'rejected', updated_at = now()
    where je.linked_settlement_id = new.id
      and je.status in ('confirmed', 'ai_suggested')
      and not exists (select 1 from closing_checklists cc where cc.company_id = je.company_id
            and cc.month = to_char(je.entry_date, 'YYYY-MM') and cc.status = 'locked');
  return null;
end;
$$;

drop trigger if exists trg_settlement_void_voucher on public.invoice_settlements;
create trigger trg_settlement_void_voucher
  after update on public.invoice_settlements
  for each row when (old.status = 'confirmed' and new.status is distinct from 'confirmed')
  execute function public.void_settlement_voucher();

-- ── 3. 백필: 이미 확정된 정산의 미기장 초안(ai_suggested) → 기장(confirmed) ──
--   확정 매칭은 B안에서 장부 반영이 전제. 잠금월/중복 확정은 제외.
update journal_entries je
  set status = 'confirmed', is_approved = true, reviewed_at = now(), updated_at = now()
  where je.status = 'ai_suggested'
    and je.linked_settlement_id is not null
    and exists (select 1 from invoice_settlements s where s.id = je.linked_settlement_id and s.status = 'confirmed')
    and not exists (select 1 from closing_checklists cc where cc.company_id = je.company_id
          and cc.month = to_char(je.entry_date, 'YYYY-MM') and cc.status = 'locked')
    and not exists (select 1 from journal_entries j2 where j2.linked_settlement_id = je.linked_settlement_id
          and j2.id <> je.id and j2.status = 'confirmed');
