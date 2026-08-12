-- 입금매칭을 지웠다 다시 하면 전표가 두 개가 되던 것 (2026-08-12 사장님 제보)
--
--   증상: 6/9 한국임업진흥원 7,000,000 이 전표목록에 **두 줄**. 차/대가 똑같은 전표가 두 개다.
--
--   History — 구멍은 **DELETE** 였다.
--     · 매칭 확정: `trg_settlement_post_voucher` (AFTER INSERT OR UPDATE, status='confirmed') → 전표 생성
--     · 매칭 해제: `trg_settlement_void_voucher` (AFTER **UPDATE**, confirmed → 그 밖) → 전표 rejected
--     · 매칭 **삭제**: 트리거가 **없다**. 그런데 journal_entries 의 linked_settlement_id·linked_bank_tx_id
--       FK 가 `ON DELETE SET NULL` 이라 행이 지워지면 **전표는 confirmed 로 남고 연결만 끊긴다**.
--       그 전표는 왜 생겼는지도 알 수 없는 고아가 된다.
--     · 그 뒤 규칙이 같은 입금을 다시 매칭하면, post_settlement_voucher 의 중복 방지가
--       `linked_settlement_id = new.id` **하나뿐**이라 새 매칭 id 로는 안 걸려 **또 만든다**.
--
--   실제 피해(모티브이노베이션): 계산서 4건이 두 번 기장돼 보통예금·외상매출금이 각각
--     **9,782,111원** 부풀어 있었다 (헥토데이터 1,987,093 · 132,000 · 희일커뮤니케이션 663,018 ·
--     한국임업진흥원 7,000,000). 8/12 재무상태표의 매출채권 이상치와 같은 뿌리다.

-- ── 1) 매칭을 '지웠을' 때도 전표를 무효로 ───────────────────────────────────
--   BEFORE DELETE 여야 한다 — FK 의 SET NULL 이 돌기 전이라 linked_settlement_id 가 아직 살아 있다.
--   지우지 않고 rejected 로 둔다: 재무제표는 confirmed 만 읽으니 합계에서 빠지고,
--   "왜 이 전표가 있었나"는 reason('settlement=<id> | …')에 그대로 남는다.
--   마감(locked)된 달은 건드리지 않는다 — 해제 트리거와 같은 규칙.
CREATE OR REPLACE FUNCTION public.void_settlement_voucher_on_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update journal_entries je
    set status = 'rejected', updated_at = now()
    where je.linked_settlement_id = old.id
      and je.status in ('confirmed', 'ai_suggested')
      and not exists (select 1 from closing_checklists cc where cc.company_id = je.company_id
            and cc.month = to_char(je.entry_date, 'YYYY-MM') and cc.status = 'locked');
  return old;
end;
$function$;

DROP TRIGGER IF EXISTS trg_settlement_void_voucher_del ON public.invoice_settlements;
CREATE TRIGGER trg_settlement_void_voucher_del
  BEFORE DELETE ON public.invoice_settlements
  FOR EACH ROW EXECUTE FUNCTION public.void_settlement_voucher_on_delete();

-- ── 2) 중복 방지 기준을 넓힌다 ─────────────────────────────────────────────
--   1) 로 고아는 안 생기지만, 이미 생긴 것·다른 경로로 끊긴 것까지 막으려면
--   "같은 계산서 + 같은 입출금 줄" 로도 본다. 돈이 같으면 전표도 하나여야 한다.
--   ⚠️ 조정분(adjustment: 원천징수·수수료 차감)은 **같은 계산서·같은 입출금에 정당하게 한 줄 더** 붙는다.
--     그래서 조정분은 이 검사에서 빼고, 상대편도 조정분이면 안 센다(reason 에 '/adjustment ' 가 있다).
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
$function$;

-- ── 3) 이미 생긴 이중 전표 정리 ────────────────────────────────────────────
--   대상: 매칭이 끊긴 **고아**(linked_settlement_id is null) 이면서, 같은 계산서에 살아 있는
--   전표가 따로 있는 것. 살아 있는 쪽이 정본이다. 지우지 않고 rejected — 되돌릴 수 있게.
--   마감된 달은 제외.
UPDATE public.journal_entries je
SET status = 'rejected', updated_at = now()
WHERE je.reference_type = 'settlement' AND je.status = 'confirmed'
  AND je.linked_settlement_id IS NULL
  AND EXISTS (SELECT 1 FROM public.journal_entries o
        WHERE o.company_id = je.company_id AND o.reference_type = 'settlement'
          AND o.linked_invoice_id = je.linked_invoice_id
          AND o.linked_settlement_id IS NOT NULL AND o.status = 'confirmed' AND o.id <> je.id)
  AND NOT EXISTS (SELECT 1 FROM public.closing_checklists cc WHERE cc.company_id = je.company_id
        AND cc.month = to_char(je.entry_date, 'YYYY-MM') AND cc.status = 'locked');
