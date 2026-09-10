-- 전표를 만들고·고치고·지우는 입구를 한 벌의 규칙으로 맞춘다.
--   문제: 같은 일을 하는 RPC 가 11개인데 마감월 검사는 그중 절반에만 있었고(통장·카드·현금영수증·계산서 일괄 전표처리는
--   마감된 달에도 전표를 꽂았다), 전표 반려는 카드·통장 연결만 풀어 계산서·현금영수증이 영원히 '확정'으로 남았으며,
--   '장부 제외'·'기존 전표에 연결'은 화면이 거래 표를 직접 UPDATE 해 권한·마감 검사를 하나도 거치지 않았다.
--   또 post_card/cash/invoice_voucher 의 현행 본문이 저장소에 없어(20260811005240 주석) 재현이 불가능했다 — 여기 전문을 되돌린다.
--
--   규칙(한 곳):
--     _voucher_assert_open(회사, 날짜)  : 마감(locked)월이면 PERIOD_LOCKED
--     _next_voucher_no(회사, 날짜)      : 같은 날짜 채번을 트랜잭션 자문 잠금으로 직렬화 + 유니크 인덱스
--     _bank_tx_is_in(type, amount)      : 통장 입출 판정(화면·서버 공통, 한글 '입금/출금'·빈 값 포함)
--     _voucher_audit(회사, 전표, 행위)  : 수정·반려 전 스냅샷을 journal_entry_audits 에 남긴다
begin;

-- ── 공용 규칙 ────────────────────────────────────────────────────────────────
create or replace function public._voucher_assert_open(p_company uuid, p_date date)
returns void language plpgsql stable set search_path to 'public' as $$
begin
  if p_date is null then raise exception 'NO_DATE'; end if;
  if exists (select 1 from closing_checklists cc
             where cc.company_id = p_company and cc.month = to_char(p_date, 'YYYY-MM') and cc.status = 'locked') then
    raise exception 'PERIOD_LOCKED';
  end if;
end $$;

create or replace function public._next_voucher_no(p_company uuid, p_date date)
returns integer language plpgsql set search_path to 'public' as $$
declare v_no integer;
begin
  -- 같은 회사·같은 날짜의 채번을 트랜잭션 끝까지 직렬화한다(두 사람이 동시에 처리해도 번호가 겹치지 않는다)
  perform pg_advisory_xact_lock(hashtext(p_company::text || '|' || p_date::text));
  select coalesce(max(voucher_no), 0) + 1 into v_no
    from journal_entries where company_id = p_company and entry_date = p_date;
  return v_no;
end $$;

create unique index if not exists journal_entries_company_date_no_uniq
  on public.journal_entries (company_id, entry_date, voucher_no) where voucher_no is not null;

create or replace function public._bank_tx_is_in(p_type text, p_amount numeric)
returns boolean language sql immutable as $$
  select case
    when p_type in ('income', 'deposit', '입금', 'in')       then true
    when p_type in ('expense', 'withdrawal', '출금', 'out') then false
    else coalesce(p_amount, 0) > 0
  end
$$;

create or replace function public._voucher_audit(p_company uuid, p_entry_id uuid, p_action text, p_actor uuid)
returns void language plpgsql set search_path to 'public' as $$
declare v_before jsonb;
begin
  select jsonb_build_object(
    'entry_date', e.entry_date, 'description', e.description, 'status', e.status,
    'vat_type', e.vat_type, 'supply_amount', e.supply_amount, 'vat_amount', e.vat_amount,
    'reference_type', e.reference_type, 'reference_id', e.reference_id,
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'account_id', jl.account_id, 'debit', jl.debit, 'credit', jl.credit,
        'partner_id', jl.partner_id, 'bank_account_id', jl.bank_account_id, 'card_id', jl.card_id, 'memo', jl.description
      ) order by jl.id) from journal_lines jl where jl.entry_id = e.id), '[]'::jsonb))
  into v_before from journal_entries e where e.id = p_entry_id;
  insert into journal_entry_audits (company_id, entry_id, action, actor_id, before)
  values (p_company, p_entry_id, p_action, p_actor, v_before);
end $$;

-- 전표 줄의 참조 값(계정·거래처·통장·카드)이 전부 이 회사 것인지 — 줄 검증도 한 곳에서
create or replace function public._voucher_check_lines(p_company uuid, p_lines jsonb, out o_debit numeric, out o_credit numeric)
language plpgsql stable set search_path to 'public' as $$
declare v_line jsonb; v_d numeric; v_c numeric; v_acct uuid;
begin
  o_debit := 0; o_credit := 0;
  if p_lines is null or jsonb_array_length(p_lines) < 2 then raise exception 'NEED_TWO_LINES'; end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_d := coalesce((v_line->>'debit')::numeric, 0);
    v_c := coalesce((v_line->>'credit')::numeric, 0);
    if v_d < 0 or v_c < 0 or (v_d > 0 and v_c > 0) or (v_d = 0 and v_c = 0) then raise exception 'INVALID_LINE_AMOUNT'; end if;
    v_acct := nullif(v_line->>'account_id', '')::uuid;
    if v_acct is null or not exists (select 1 from chart_of_accounts a where a.id = v_acct and a.company_id = p_company) then raise exception 'INVALID_ACCOUNT'; end if;
    if coalesce(v_line->>'bank_account_id', '') <> ''
       and not exists (select 1 from bank_accounts b where b.id = (v_line->>'bank_account_id')::uuid and b.company_id = p_company) then raise exception 'INVALID_BANK_ACCOUNT'; end if;
    if coalesce(v_line->>'card_id', '') <> ''
       and not exists (select 1 from corporate_cards c where c.id = (v_line->>'card_id')::uuid and c.company_id = p_company) then raise exception 'INVALID_CARD'; end if;
    if coalesce(v_line->>'partner_id', '') <> ''
       and not exists (select 1 from partners p where p.id = (v_line->>'partner_id')::uuid and p.company_id = p_company) then raise exception 'INVALID_PARTNER'; end if;
    o_debit := o_debit + v_d; o_credit := o_credit + v_c;
  end loop;
  if o_debit <= 0 or o_debit <> o_credit then raise exception 'UNBALANCED'; end if;
end $$;

-- ── 일반전표 저장: 참조(원거래)를 받아 연결까지 한다 ─────────────────────────
--   수집·전표의 '3. 일반'이 이 함수를 참조 없이 불러 카드 거래가 영원히 '미처리'로 남고 누를 때마다 전표가 또 생겼다.
drop function if exists public.save_manual_voucher(date, text, text, jsonb);
create or replace function public.save_manual_voucher(
  p_entry_date date, p_voucher_type text, p_description text, p_lines jsonb,
  p_reference_type text default null, p_reference_id uuid default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_company uuid := public.get_my_company_id();
  v_uid uuid; v_entry_id uuid; v_no integer; v_line jsonb; v_tot record;
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  if not (public.is_company_admin()
          or public.has_perm('/partners/reconciliation/voucher-entry')
          or public.has_perm('/partners/reconciliation/sale-purchase')
          or public.has_perm('/collect')) then
    raise exception 'FORBIDDEN';
  end if;
  if p_voucher_type is null or p_voucher_type not in ('cash_out','cash_in','transfer') then raise exception 'INVALID_TYPE'; end if;
  if p_reference_type is not null and p_reference_type not in ('bank_transaction','card_transaction','cash_receipt','tax_invoice') then
    raise exception 'INVALID_REFERENCE';
  end if;
  perform public._voucher_assert_open(v_company, p_entry_date);
  select * into v_tot from public._voucher_check_lines(v_company, p_lines);

  if p_reference_type is not null and p_reference_id is not null then
    -- 원거래가 이 회사 것이고 아직 전표가 없어야 한다
    if p_reference_type = 'bank_transaction' and not exists (select 1 from bank_transactions t where t.id = p_reference_id and t.company_id = v_company and t.journal_entry_id is null) then raise exception 'ALREADY_POSTED'; end if;
    if p_reference_type = 'card_transaction' and not exists (select 1 from card_transactions t where t.id = p_reference_id and t.company_id = v_company and t.journal_entry_id is null) then raise exception 'ALREADY_POSTED'; end if;
    if p_reference_type = 'cash_receipt'     and not exists (select 1 from cash_receipts t where t.id = p_reference_id and t.company_id = v_company and t.journal_entry_id is null) then raise exception 'ALREADY_POSTED'; end if;
    if p_reference_type = 'tax_invoice'      and not exists (select 1 from tax_invoices t where t.id = p_reference_id and t.company_id = v_company and t.journal_entry_id is null) then raise exception 'ALREADY_POSTED'; end if;
    if exists (select 1 from journal_entries je where je.company_id = v_company and je.reference_type = p_reference_type
                 and je.reference_id = p_reference_id and je.status <> 'rejected') then raise exception 'ALREADY_POSTED'; end if;
  end if;

  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;
  v_no := public._next_voucher_no(v_company, p_entry_date);

  insert into journal_entries (company_id, entry_date, description, source, status, is_approved,
    voucher_no, voucher_type, entry_kind, reference_type, reference_id, created_by, approved_by, reviewed_by, reviewed_at)
  values (v_company, p_entry_date, coalesce(p_description, ''), 'manual', 'confirmed', true,
    v_no, p_voucher_type, 'general', p_reference_type, p_reference_id, v_uid, v_uid, v_uid, now())
  returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id, bank_account_id, card_id)
    values (v_entry_id, v_company, (v_line->>'account_id')::uuid,
      coalesce((v_line->>'debit')::numeric, 0), coalesce((v_line->>'credit')::numeric, 0), coalesce(v_line->>'memo', ''),
      nullif(v_line->>'partner_id', '')::uuid, nullif(v_line->>'bank_account_id', '')::uuid, nullif(v_line->>'card_id', '')::uuid);
  end loop;

  if p_reference_id is not null then
    if p_reference_type = 'bank_transaction' then
      update bank_transactions set journal_entry_id = v_entry_id, mapping_status = 'manual_mapped', mapped_by = v_uid, mapped_at = now() where id = p_reference_id and company_id = v_company;
    elsif p_reference_type = 'card_transaction' then
      update card_transactions set journal_entry_id = v_entry_id, mapping_status = 'manual_mapped', mapped_by = v_uid, mapped_at = now() where id = p_reference_id and company_id = v_company;
    elsif p_reference_type = 'cash_receipt' then
      update cash_receipts set journal_entry_id = v_entry_id where id = p_reference_id and company_id = v_company;
    elsif p_reference_type = 'tax_invoice' then
      update tax_invoices set journal_entry_id = v_entry_id where id = p_reference_id and company_id = v_company;
    end if;
  end if;
  return v_entry_id;
end $$;
revoke all on function public.save_manual_voucher(date, text, text, jsonb, text, uuid) from public, anon;
grant execute on function public.save_manual_voucher(date, text, text, jsonb, text, uuid) to authenticated, service_role;

-- ── 일반전표 수정: 매입매출전표는 못 들어오게 (원장 팝업이 이 함수로 부가세 값 없이 줄만 바꾸던 구멍) ──
create or replace function public.update_manual_voucher(p_entry_id uuid, p_entry_date date, p_description text, p_lines jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := public.get_my_company_id(); v_uid uuid; v_e record; v_line jsonb; v_tot record;
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  if not (public.is_company_admin() or public.has_perm('/partners/reconciliation/voucher-entry')) then raise exception 'FORBIDDEN'; end if;
  if p_entry_date is null then raise exception 'NO_DATE'; end if;
  select * into v_e from journal_entries where id = p_entry_id and company_id = v_company;
  if v_e.id is null then raise exception 'NOT_FOUND'; end if;
  if coalesce(v_e.entry_kind, '') = 'sale_purchase' then raise exception 'NOT_MANUAL'; end if;
  if v_e.source <> 'manual' and not (v_e.source = 'rule' and v_e.linked_settlement_id is not null) then raise exception 'NOT_MANUAL'; end if;
  if v_e.status <> 'confirmed' then raise exception 'NOT_FOUND_OR_INVALID'; end if;
  perform public._voucher_assert_open(v_company, v_e.entry_date);
  perform public._voucher_assert_open(v_company, p_entry_date);
  select * into v_tot from public._voucher_check_lines(v_company, p_lines);
  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;
  perform public._voucher_audit(v_company, p_entry_id, 'update', v_uid);
  delete from journal_lines where entry_id = p_entry_id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id, bank_account_id, card_id)
    values (p_entry_id, v_company, (v_line->>'account_id')::uuid,
      coalesce((v_line->>'debit')::numeric, 0), coalesce((v_line->>'credit')::numeric, 0), coalesce(v_line->>'memo', ''),
      nullif(v_line->>'partner_id', '')::uuid, nullif(v_line->>'bank_account_id', '')::uuid, nullif(v_line->>'card_id', '')::uuid);
  end loop;
  update journal_entries set entry_date = p_entry_date, description = coalesce(p_description, description),
    reviewed_by = v_uid, reviewed_at = now(), updated_at = now() where id = p_entry_id;
end $$;

-- ── 전표 반려: 원거래 5종 연결을 전부 풀고, 삭제 전 스냅샷을 남긴다 ─────────
create or replace function public._voucher_unlink_all(p_company uuid, p_entry_id uuid)
returns text language plpgsql set search_path to 'public' as $$
declare v_freed text := '';
begin
  update tax_invoices set journal_entry_id = null where company_id = p_company and journal_entry_id = p_entry_id;
  if found then v_freed := 'tax_invoice'; end if;
  update cash_receipts set journal_entry_id = null where company_id = p_company and journal_entry_id = p_entry_id;
  if found then v_freed := 'cash_receipt'; end if;
  update card_transactions set journal_entry_id = null, mapping_status = 'unmapped', mapped_by = null, mapped_at = null
    where company_id = p_company and journal_entry_id = p_entry_id;
  if found then v_freed := 'card'; end if;
  update bank_transactions set journal_entry_id = null,
      settlement_status = case when settlement_status = 'settled' then 'open' else settlement_status end
    where company_id = p_company and journal_entry_id = p_entry_id;
  if found then v_freed := 'bank'; end if;
  update stock_docs set journal_entry_id = null where company_id = p_company and journal_entry_id = p_entry_id;
  if found then v_freed := 'stock_doc'; end if;
  return v_freed;
end $$;

create or replace function public.voucher_reject(p_entry_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := public.get_my_company_id(); v_uid uuid; v_e record;
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  if not (public.is_company_admin() or public.has_perm('/partners/reconciliation/voucher-entry')
          or public.has_perm('/partners/reconciliation/sale-purchase')) then raise exception 'FORBIDDEN'; end if;
  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;
  select * into v_e from journal_entries where id = p_entry_id and company_id = v_company;
  if v_e.id is null or v_e.status not in ('ai_suggested','confirmed') then raise exception 'NOT_FOUND_OR_INVALID'; end if;
  if v_e.status = 'confirmed' then perform public._voucher_assert_open(v_company, v_e.entry_date); end if;
  perform public._voucher_audit(v_company, p_entry_id, 'reject', v_uid);
  update journal_entries set status = 'rejected', is_approved = false, reviewed_by = v_uid, reviewed_at = now(), updated_at = now() where id = p_entry_id;
  perform public._voucher_unlink_all(v_company, p_entry_id);
end $$;

create or replace function public.unpost_evidence_voucher(p_entry_id uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := public.get_my_company_id(); v_uid uuid; v_e record; v_freed text;
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  if not (public.is_company_admin() or public.has_perm('/partners/reconciliation/voucher-entry')
          or public.has_perm('/partners/reconciliation/sale-purchase')) then raise exception 'FORBIDDEN'; end if;
  select * into v_e from journal_entries where id = p_entry_id and company_id = v_company;
  if v_e.id is null or v_e.status not in ('ai_suggested', 'confirmed') then raise exception 'NOT_FOUND_OR_INVALID'; end if;
  perform public._voucher_assert_open(v_company, v_e.entry_date);
  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;
  perform public._voucher_audit(v_company, p_entry_id, 'reject', v_uid);
  v_freed := public._voucher_unlink_all(v_company, p_entry_id);
  update journal_entries set status = 'rejected', is_approved = false, reviewed_by = v_uid, reviewed_at = now(), updated_at = now() where id = p_entry_id;
  return v_freed;
end $$;

-- ── 통장 거래 → 전표 (/bank·거래 대사 화면) ─────────────────────────────────
drop function if exists public.post_bank_voucher(uuid, uuid, boolean);
create or replace function public.post_bank_voucher(p_bank_tx_id uuid, p_account_id uuid, p_remember boolean default false, p_memo text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := public.get_my_company_id(); v_uid uuid; v_tx record; v_bank_acct uuid; v_entry_id uuid; v_no integer;
        v_amount numeric; v_is_in boolean; v_acct_name text; v_bankpartner uuid;
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  if not (public.is_company_admin() or public.has_perm('/collect') or public.has_perm('/partners/reconciliation/voucher-entry')) then raise exception 'FORBIDDEN'; end if;
  select * into v_tx from bank_transactions where id = p_bank_tx_id and company_id = v_company;
  if not found then raise exception 'INVALID_TX'; end if;
  if v_tx.journal_entry_id is not null then raise exception 'ALREADY_POSTED'; end if;
  perform public._voucher_assert_open(v_company, v_tx.transaction_date);
  select name into v_acct_name from chart_of_accounts where id = p_account_id and company_id = v_company;
  if v_acct_name is null then raise exception 'INVALID_ACCOUNT'; end if;
  select id into v_bank_acct from chart_of_accounts where company_id = v_company and code = '103' limit 1;
  if v_bank_acct is null then raise exception 'NO_BANK_ACCOUNT'; end if;
  v_amount := abs(coalesce(v_tx.amount, 0));
  if v_amount = 0 then raise exception 'ZERO_AMOUNT'; end if;
  v_is_in := public._bank_tx_is_in(v_tx.type, v_tx.amount);
  v_bankpartner := public.find_or_create_bank_partner(v_tx.bank_account_id);
  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;
  v_no := public._next_voucher_no(v_company, v_tx.transaction_date);
  insert into journal_entries (company_id, entry_date, description, source, status, is_approved, deal_id,
    voucher_no, voucher_type, entry_kind, reference_type, reference_id, created_by, approved_by, reviewed_by, reviewed_at)
  values (v_company, v_tx.transaction_date, coalesce(nullif(p_memo, ''), v_tx.description, v_tx.counterparty, '통장 거래'),
    'manual', 'confirmed', true, v_tx.deal_id, v_no, case when v_is_in then 'cash_in' else 'cash_out' end, 'general',
    'bank_transaction', p_bank_tx_id, v_uid, v_uid, v_uid, now()) returning id into v_entry_id;
  -- 수집·전표(post_bank_manual_voucher)와 같은 모양: 통장 줄엔 통장 거래처·계좌, 상대 줄엔 거래처
  if v_is_in then
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id, bank_account_id) values
      (v_entry_id, v_company, v_bank_acct, v_amount, 0, coalesce(p_memo, v_tx.counterparty, ''), v_bankpartner, v_tx.bank_account_id),
      (v_entry_id, v_company, p_account_id, 0, v_amount, coalesce(p_memo, v_tx.counterparty, ''), v_tx.partner_id, null);
  else
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id, bank_account_id) values
      (v_entry_id, v_company, p_account_id, v_amount, 0, coalesce(p_memo, v_tx.counterparty, ''), v_tx.partner_id, null),
      (v_entry_id, v_company, v_bank_acct, 0, v_amount, coalesce(p_memo, v_tx.counterparty, ''), v_bankpartner, v_tx.bank_account_id);
  end if;
  update bank_transactions set journal_entry_id = v_entry_id, category = v_acct_name, classification = v_acct_name,
    mapping_status = 'manual_mapped', mapped_by = v_uid, mapped_at = now() where id = p_bank_tx_id and company_id = v_company;
  return v_entry_id;
end $$;

create or replace function public.post_bank_manual_voucher(p_bank_tx_id uuid, p_account_id uuid, p_partner_id uuid default null, p_memo text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := public.get_my_company_id(); v_uid uuid; v_tx record; v_bankacct uuid; v_bankpartner uuid; v_entry uuid;
        v_amt numeric; v_in boolean; v_memo text; v_no integer;
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  if not (public.is_company_admin() or public.has_perm('/partners/reconciliation/voucher-entry')
          or public.has_perm('/partners/reconciliation/sale-purchase') or public.has_perm('/collect')) then raise exception 'FORBIDDEN'; end if;
  select * into v_tx from bank_transactions where id = p_bank_tx_id and company_id = v_company;
  if v_tx.id is null then raise exception 'NOT_FOUND'; end if;
  if v_tx.journal_entry_id is not null then raise exception 'ALREADY_POSTED'; end if;
  v_amt := abs(coalesce(v_tx.amount, 0));
  if v_amt = 0 then raise exception 'INVALID_AMOUNT'; end if;
  perform public._voucher_assert_open(v_company, v_tx.transaction_date);
  if p_account_id is null or not exists (select 1 from chart_of_accounts a where a.id = p_account_id and a.company_id = v_company) then raise exception 'INVALID_ACCOUNT'; end if;
  if p_partner_id is not null and not exists (select 1 from partners p where p.id = p_partner_id and p.company_id = v_company) then raise exception 'INVALID_PARTNER'; end if;
  v_in := public._bank_tx_is_in(v_tx.type, v_tx.amount);
  v_bankacct := public.find_account(v_company, '103', '보통예금');
  if v_bankacct is null then raise exception 'NO_BANK_ACCOUNT'; end if;
  v_bankpartner := public.find_or_create_bank_partner(v_tx.bank_account_id);
  v_memo := nullif(trim(coalesce(p_memo, '')), '');
  v_memo := coalesce(v_memo, nullif(trim(coalesce(v_tx.description, '')), ''), nullif(trim(coalesce(v_tx.counterparty, '')), ''), '');
  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;
  v_no := public._next_voucher_no(v_company, v_tx.transaction_date);
  insert into journal_entries (company_id, entry_date, description, source, status, is_approved,
    voucher_no, voucher_type, entry_kind, reference_type, reference_id, created_by, approved_by, reviewed_by, reviewed_at)
  values (v_company, v_tx.transaction_date, v_memo, 'manual', 'confirmed', true,
    v_no, case when v_in then 'cash_in' else 'cash_out' end, 'general', 'bank_transaction', v_tx.id, v_uid, v_uid, v_uid, now())
  returning id into v_entry;
  if v_in then
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id, bank_account_id) values
      (v_entry, v_company, v_bankacct, v_amt, 0, v_memo, v_bankpartner, v_tx.bank_account_id),
      (v_entry, v_company, p_account_id, 0, v_amt, v_memo, p_partner_id, null);
  else
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id, bank_account_id) values
      (v_entry, v_company, p_account_id, v_amt, 0, v_memo, p_partner_id, null),
      (v_entry, v_company, v_bankacct, 0, v_amt, v_memo, v_bankpartner, v_tx.bank_account_id);
  end if;
  update bank_transactions set journal_entry_id = v_entry, mapping_status = 'manual_mapped', mapped_by = v_uid, mapped_at = now() where id = p_bank_tx_id;
  return v_entry;
end $$;

-- ── 카드 거래 → 전표 (/cards) — 운영 현행 본문 + 마감·채번 규칙 ──────────────
create or replace function public.post_card_voucher(p_card_tx_id uuid, p_account_id uuid, p_remember boolean default false)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := public.get_my_company_id(); v_uid uuid; v_card record; v_cash uuid; v_payable uuid; v_vatin uuid; v_entry uuid;
        v_acct_name text; v_vat_type text; v_supply numeric; v_vat numeric; v_cardpartner uuid; v_no integer;
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  if not (public.is_company_admin() or public.has_perm('/partners/reconciliation/voucher-entry')
          or public.has_perm('/partners/reconciliation/sale-purchase') or public.has_perm('/collect')) then raise exception 'FORBIDDEN'; end if;
  select * into v_card from card_transactions where id = p_card_tx_id and company_id = v_company;
  if v_card.id is null then raise exception 'NOT_FOUND'; end if;
  if v_card.journal_entry_id is not null then raise exception 'ALREADY_POSTED'; end if;
  if v_card.amount is null or v_card.amount = 0 then raise exception 'INVALID_AMOUNT'; end if;
  perform public._voucher_assert_open(v_company, v_card.transaction_date);
  if p_account_id is null or not exists (select 1 from chart_of_accounts a where a.id = p_account_id and a.company_id = v_company) then raise exception 'INVALID_ACCOUNT'; end if;
  select name into v_acct_name from chart_of_accounts where id = p_account_id;
  v_cash    := public.find_account(v_company, '103', '보통예금');
  v_payable := public.find_account(v_company, '253', '미지급금');
  v_vatin   := public.find_account(v_company, '135', '부가세대급금');
  if v_cash is null and v_payable is null then raise exception 'NO_CASH_ACCOUNT'; end if;
  v_vat_type := case when coalesce(v_acct_name, '') like '%접대비%' then '54' else '57' end;
  v_supply := case when v_vat_type = '57' then round(v_card.amount / 1.1) else v_card.amount end;
  v_vat := v_card.amount - v_supply;
  v_cardpartner := public.find_or_create_card_partner(v_company, v_card.card_name);
  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;
  v_no := public._next_voucher_no(v_company, v_card.transaction_date);
  insert into journal_entries (company_id, entry_date, description, source, status, is_approved, deal_id,
    voucher_type, entry_kind, vat_type, supply_amount, vat_amount, reference_type, reference_id,
    voucher_no, created_by, approved_by, reviewed_by, reviewed_at)
  values (v_company, v_card.transaction_date, coalesce(v_card.merchant_name, ''), 'manual', 'confirmed', true, v_card.deal_id,
    'cash_out', 'sale_purchase', v_vat_type, v_supply, v_vat, 'card_transaction', v_card.id,
    v_no, v_uid, v_uid, v_uid, now()) returning id into v_entry;
  -- 차변(비용)은 가맹점, 대변(미지급금)은 카드사
  if v_vat > 0 and v_vatin is not null then
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id) values
      (v_entry, v_company, p_account_id, v_supply, 0, coalesce(v_card.merchant_name, ''), null),
      (v_entry, v_company, v_vatin, v_vat, 0, '부가세대급금', null),
      (v_entry, v_company, coalesce(v_payable, v_cash), 0, v_card.amount, coalesce(v_card.card_name, v_card.merchant_name, ''), v_cardpartner);
  else
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id) values
      (v_entry, v_company, p_account_id, v_card.amount, 0, coalesce(v_card.merchant_name, ''), null),
      (v_entry, v_company, coalesce(v_payable, v_cash), 0, v_card.amount, coalesce(v_card.card_name, v_card.merchant_name, ''), v_cardpartner);
  end if;
  update card_transactions set journal_entry_id = v_entry, mapping_status = 'manual_mapped', mapped_by = v_uid, mapped_at = now() where id = p_card_tx_id;
  if p_remember and coalesce(v_card.category, '') <> '' then
    insert into card_account_mappings (company_id, category, account_id, updated_at)
    values (v_company, v_card.category, p_account_id, now())
    on conflict (company_id, category) do update set account_id = excluded.account_id, updated_at = now();
  end if;
  return v_entry;
end $$;

-- ── 현금영수증 → 전표 — 운영 현행 본문 + 마감·채번 규칙 ────────────────────
create or replace function public.post_cash_voucher(p_cash_receipt_id uuid, p_account_id uuid, p_remember boolean default false)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := public.get_my_company_id(); v_uid uuid; v_r record; v_cash uuid; v_vatin uuid; v_vatout uuid; v_entry uuid;
        v_total numeric; v_net numeric; v_vat numeric; v_is_sales boolean; v_vat_type text; v_acct_name text; v_sign smallint; v_desc text; v_no integer;
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  if not (public.is_company_admin() or public.has_perm('/partners/reconciliation/voucher-entry')
          or public.has_perm('/partners/reconciliation/sale-purchase') or public.has_perm('/collect')) then raise exception 'FORBIDDEN'; end if;
  select * into v_r from cash_receipts where id = p_cash_receipt_id and company_id = v_company;
  if v_r.id is null then raise exception 'NOT_FOUND'; end if;
  if v_r.journal_entry_id is not null then raise exception 'ALREADY_POSTED'; end if;
  perform public._voucher_assert_open(v_company, v_r.issue_date);
  v_sign := case when coalesce(v_r.status, 'issued') = 'void' then 0
                 when coalesce(v_r.status, 'issued') <> 'cancelled' then 1
                 when v_r.source = 'hometax_sync' then -1 else 0 end;
  if v_sign = 0 then raise exception 'CANCELLED_RECEIPT'; end if;
  v_total := coalesce(v_r.amount, v_r.supply_amount);
  v_net := coalesce(v_r.supply_amount, v_r.amount);
  if v_total is null or v_total = 0 then raise exception 'INVALID_AMOUNT'; end if;
  v_vat := greatest(coalesce(v_total, 0) - coalesce(v_net, 0), 0);
  if p_account_id is null or not exists (select 1 from chart_of_accounts a where a.id = p_account_id and a.company_id = v_company) then raise exception 'INVALID_ACCOUNT'; end if;
  select name into v_acct_name from chart_of_accounts where id = p_account_id;
  v_cash   := public.find_account(v_company, '103', '보통예금');
  v_vatin  := public.find_account(v_company, '135', '부가세대급금');
  v_vatout := public.find_account(v_company, '255', '부가세예수금');
  if v_cash is null then raise exception 'NO_CASH_ACCOUNT'; end if;
  v_is_sales := (v_r.type = 'income');
  v_vat_type := case when v_is_sales then '22' when coalesce(v_acct_name, '') like '%접대비%' then '54' else '61' end;
  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;
  v_desc := coalesce(v_r.counterparty_name, '') || case when v_sign < 0 then ' (취소거래)' else '' end;
  v_no := public._next_voucher_no(v_company, v_r.issue_date);
  insert into journal_entries (company_id, entry_date, description, source, status, is_approved, deal_id,
    voucher_type, entry_kind, vat_type, supply_amount, vat_amount, reference_type, reference_id,
    voucher_no, created_by, approved_by, reviewed_by, reviewed_at)
  values (v_company, v_r.issue_date, v_desc, 'manual', 'confirmed', true, v_r.deal_id,
    case when v_is_sales then 'cash_in' else 'cash_out' end, 'sale_purchase', v_vat_type, v_sign * v_net, v_sign * v_vat, 'cash_receipt', v_r.id,
    v_no, v_uid, v_uid, v_uid, now()) returning id into v_entry;
  if v_is_sales then
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description) values
      (v_entry, v_company, v_cash, v_total, 0, coalesce(v_r.counterparty_name, '')),
      (v_entry, v_company, p_account_id, 0, v_net, coalesce(v_r.counterparty_name, ''));
    if v_vat > 0 and v_vatout is not null then
      insert into journal_lines (entry_id, company_id, account_id, debit, credit, description) values (v_entry, v_company, v_vatout, 0, v_vat, '부가세예수금');
    end if;
  elsif v_vat > 0 and v_vatin is not null and v_vat_type <> '54' then
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description) values
      (v_entry, v_company, p_account_id, v_net, 0, coalesce(v_r.counterparty_name, '')),
      (v_entry, v_company, v_vatin, v_vat, 0, '부가세대급금'),
      (v_entry, v_company, v_cash, 0, v_total, coalesce(v_r.counterparty_name, ''));
  else
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description) values
      (v_entry, v_company, p_account_id, v_total, 0, coalesce(v_r.counterparty_name, '')),
      (v_entry, v_company, v_cash, 0, v_total, coalesce(v_r.counterparty_name, ''));
  end if;
  -- 취소거래 = 반대 분개(좌우만 뒤집는다)
  if v_sign < 0 then update journal_lines set debit = credit, credit = debit where entry_id = v_entry; end if;
  update cash_receipts set journal_entry_id = v_entry where id = p_cash_receipt_id;
  return v_entry;
end $$;

-- ── 세금계산서 → 전표 — 운영 현행 본문 + 마감·채번 규칙 ────────────────────
create or replace function public.post_invoice_voucher(p_tax_invoice_id uuid, p_account_id uuid, p_remember boolean default false)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := public.get_my_company_id(); v_uid uuid; v_inv record; v_entry uuid; v_ap uuid; v_ar uuid; v_vatin uuid; v_vatout uuid;
        v_supply numeric; v_tax numeric; v_total numeric; v_is_sales boolean; v_acct_name text; v_vat_type text; v_no integer;
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  if not (public.is_company_admin() or public.has_perm('/partners/reconciliation/voucher-entry')
          or public.has_perm('/partners/reconciliation/sale-purchase') or public.has_perm('/collect')) then raise exception 'FORBIDDEN'; end if;
  select * into v_inv from tax_invoices where id = p_tax_invoice_id and company_id = v_company;
  if v_inv.id is null then raise exception 'NOT_FOUND'; end if;
  if v_inv.journal_entry_id is not null then raise exception 'ALREADY_POSTED'; end if;
  if coalesce(v_inv.status, '') = 'void' then raise exception 'VOID_INVOICE'; end if;
  perform public._voucher_assert_open(v_company, v_inv.issue_date);
  v_supply := coalesce(v_inv.supply_amount, 0);
  v_tax := coalesce(v_inv.tax_amount, 0);
  v_total := coalesce(v_inv.total_amount, v_supply + v_tax);
  if v_total = 0 then raise exception 'INVALID_AMOUNT'; end if;
  v_is_sales := (v_inv.type in ('sales', '매출'));
  if p_account_id is null or not exists (select 1 from chart_of_accounts a where a.id = p_account_id and a.company_id = v_company) then raise exception 'INVALID_ACCOUNT'; end if;
  select name into v_acct_name from chart_of_accounts where id = p_account_id;
  v_ar     := public.find_account(v_company, '108', '외상매출금');
  v_ap     := public.find_account(v_company, '251', '외상매입금');
  v_vatin  := public.find_account(v_company, '135', '부가세대급금');
  v_vatout := public.find_account(v_company, '255', '부가세예수금');
  if v_is_sales and v_ar is null then raise exception 'INVALID_ACCOUNT'; end if;
  if (not v_is_sales) and v_ap is null then raise exception 'INVALID_ACCOUNT'; end if;
  v_vat_type := case when v_is_sales and v_inv.tax_kind = 'zero_rated' then '12'
                     when v_is_sales and v_inv.tax_kind = 'exempt' then '13'
                     when v_is_sales then '11'
                     when v_inv.tax_kind = 'exempt' then '53'
                     when coalesce(v_acct_name, '') like '%접대비%' then '54' else '51' end;
  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;
  v_no := public._next_voucher_no(v_company, v_inv.issue_date);
  insert into journal_entries (company_id, entry_date, description, source, status, is_approved, deal_id,
    voucher_type, entry_kind, vat_type, supply_amount, vat_amount, reference_type, reference_id,
    voucher_no, created_by, approved_by, reviewed_by, reviewed_at)
  values (v_company, v_inv.issue_date, coalesce(v_inv.counterparty_name, ''), 'manual', 'confirmed', true, v_inv.deal_id,
    case when v_is_sales then 'cash_in' else 'cash_out' end, 'sale_purchase', v_vat_type, v_supply, v_tax, 'tax_invoice', v_inv.id,
    v_no, v_uid, v_uid, v_uid, now()) returning id into v_entry;
  if v_is_sales then
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id) values
      (v_entry, v_company, v_ar, v_total, 0, coalesce(v_inv.counterparty_name, ''), v_inv.partner_id),
      (v_entry, v_company, p_account_id, 0, v_supply, coalesce(v_inv.counterparty_name, ''), v_inv.partner_id);
    if v_tax > 0 and v_vatout is not null then
      insert into journal_lines (entry_id, company_id, account_id, debit, credit, description) values (v_entry, v_company, v_vatout, 0, v_tax, '부가세예수금');
    end if;
  elsif v_vat_type = '54' or v_vatin is null then
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id) values
      (v_entry, v_company, p_account_id, v_total, 0, coalesce(v_inv.counterparty_name, ''), v_inv.partner_id),
      (v_entry, v_company, v_ap, 0, v_total, coalesce(v_inv.counterparty_name, ''), v_inv.partner_id);
  else
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id) values
      (v_entry, v_company, p_account_id, v_supply, 0, coalesce(v_inv.counterparty_name, ''), v_inv.partner_id),
      (v_entry, v_company, v_ap, 0, v_total, coalesce(v_inv.counterparty_name, ''), v_inv.partner_id);
    if v_tax > 0 then
      insert into journal_lines (entry_id, company_id, account_id, debit, credit, description) values (v_entry, v_company, v_vatin, v_tax, 0, '부가세대급금');
    end if;
  end if;
  update tax_invoices set journal_entry_id = v_entry where id = p_tax_invoice_id;
  return v_entry;
end $$;

-- ── 매입매출전표: 채번 규칙 + 수정 쪽 유형 목록에 58·59(카드면세·카드영세) 추가 + 거래처 소유 검증 ──
create or replace function public.save_sale_purchase_voucher(p_entry_date date, p_vat_type text, p_supply_amount numeric, p_vat_amount numeric, p_description text, p_lines jsonb, p_reference_type text default null, p_reference_id uuid default null, p_electronic boolean default false)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := public.get_my_company_id(); v_uid uuid; v_entry_id uuid; v_no integer; v_line jsonb; v_tot record; v_partner uuid; v_doc_partner uuid;
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  if not (public.is_company_admin() or public.has_perm('/partners/reconciliation/voucher-entry')
          or public.has_perm('/partners/reconciliation/sale-purchase') or public.has_perm('/collect')) then raise exception 'FORBIDDEN'; end if;
  if p_vat_type is null or p_vat_type not in ('11','12','13','17','22','51','53','54','57','58','59','61') then raise exception 'INVALID_VAT_TYPE'; end if;
  if p_reference_type is not null and p_reference_type not in ('tax_invoice','card_transaction','cash_receipt','stock_doc') then raise exception 'INVALID_REFERENCE'; end if;
  perform public._voucher_assert_open(v_company, p_entry_date);
  if p_reference_type is not null and p_reference_id is not null
     and exists (select 1 from journal_entries je where je.company_id = v_company and je.reference_type = p_reference_type
                 and je.reference_id = p_reference_id and je.status <> 'rejected') then raise exception 'ALREADY_POSTED'; end if;
  select * into v_tot from public._voucher_check_lines(v_company, p_lines);
  if p_reference_type = 'tax_invoice' and p_reference_id is not null then v_partner := public.resolve_partner_for_invoice(p_reference_id); end if;
  if p_reference_type = 'stock_doc' and p_reference_id is not null then
    select d.partner_id into v_partner from stock_docs d where d.id = p_reference_id and d.company_id = v_company;
  end if;
  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;
  v_no := public._next_voucher_no(v_company, p_entry_date);
  insert into journal_entries (company_id, entry_date, description, source, status, is_approved,
    voucher_no, voucher_type, entry_kind, vat_type, supply_amount, vat_amount, reference_type, reference_id, is_electronic,
    created_by, approved_by, reviewed_by, reviewed_at)
  values (v_company, p_entry_date, coalesce(p_description, ''), 'manual', 'confirmed', true,
    v_no, 'transfer', 'sale_purchase', p_vat_type, coalesce(p_supply_amount, 0), coalesce(p_vat_amount, 0),
    p_reference_type, p_reference_id, (coalesce(p_reference_type, '') = 'tax_invoice') or coalesce(p_electronic, false),
    v_uid, v_uid, v_uid, now()) returning id into v_entry_id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id)
    values (v_entry_id, v_company, (v_line->>'account_id')::uuid,
      coalesce((v_line->>'debit')::numeric, 0), coalesce((v_line->>'credit')::numeric, 0), coalesce(v_line->>'memo', ''),
      coalesce(nullif(v_line->>'partner_id', '')::uuid, v_partner));
  end loop;
  if p_reference_id is not null then
    if p_reference_type = 'tax_invoice' then update tax_invoices set journal_entry_id = v_entry_id where id = p_reference_id and company_id = v_company;
    elsif p_reference_type = 'card_transaction' then update card_transactions set journal_entry_id = v_entry_id, mapping_status = 'manual_mapped', mapped_by = v_uid, mapped_at = now() where id = p_reference_id and company_id = v_company;
    elsif p_reference_type = 'cash_receipt' then update cash_receipts set journal_entry_id = v_entry_id where id = p_reference_id and company_id = v_company;
    elsif p_reference_type = 'stock_doc' then update stock_docs set journal_entry_id = v_entry_id where id = p_reference_id and company_id = v_company;
    end if;
  end if;
  if (p_reference_id is null or p_reference_type = 'stock_doc') and p_vat_type in ('11','12','13') then
    select (x->>'partner_id')::uuid into v_doc_partner from jsonb_array_elements(p_lines) x where coalesce(x->>'partner_id', '') <> '' limit 1;
    insert into tax_invoices (company_id, type, issue_date, partner_id, counterparty_name, counterparty_bizno, item_name,
      supply_amount, tax_amount, total_amount, tax_kind, doc_kind, status, source, nts_issue_status, journal_entry_id)
    select v_company, 'sales', p_entry_date, p.id, coalesce(p.name, ''), p.business_number, nullif(coalesce(p_description, ''), ''),
      coalesce(p_supply_amount, 0), coalesce(p_vat_amount, 0), coalesce(p_supply_amount, 0) + coalesce(p_vat_amount, 0),
      case p_vat_type when '12' then 'zero_rated' when '13' then 'exempt' else 'taxable' end,
      case p_vat_type when '13' then 'exempt' else 'tax' end, 'draft', 'manual', 'draft', v_entry_id
    from (select 1) one left join partners p on p.id = v_doc_partner and p.company_id = v_company;
  end if;
  return v_entry_id;
end $$;

create or replace function public.update_sale_purchase_voucher(p_entry_id uuid, p_entry_date date, p_vat_type text, p_supply_amount numeric, p_vat_amount numeric, p_description text, p_lines jsonb, p_electronic boolean default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := public.get_my_company_id(); v_uid uuid; v_e record; v_line jsonb; v_tot record; v_doc_partner uuid;
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  if not (public.is_company_admin() or public.has_perm('/partners/reconciliation/voucher-entry')
          or public.has_perm('/partners/reconciliation/sale-purchase')) then raise exception 'FORBIDDEN'; end if;
  if p_entry_date is null then raise exception 'NO_DATE'; end if;
  if p_vat_type is null or p_vat_type not in ('11','12','13','17','22','51','53','54','57','58','59','61') then raise exception 'INVALID_VAT_TYPE'; end if;
  select * into v_e from journal_entries where id = p_entry_id and company_id = v_company;
  if v_e.id is null then raise exception 'NOT_FOUND'; end if;
  if coalesce(v_e.entry_kind, '') <> 'sale_purchase' then raise exception 'NOT_SALE_PURCHASE'; end if;
  if v_e.status <> 'confirmed' then raise exception 'NOT_FOUND_OR_INVALID'; end if;
  perform public._voucher_assert_open(v_company, v_e.entry_date);
  perform public._voucher_assert_open(v_company, p_entry_date);
  select * into v_tot from public._voucher_check_lines(v_company, p_lines);
  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;
  perform public._voucher_audit(v_company, p_entry_id, 'update', v_uid);
  delete from journal_lines where entry_id = p_entry_id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id)
    values (p_entry_id, v_company, (v_line->>'account_id')::uuid,
      coalesce((v_line->>'debit')::numeric, 0), coalesce((v_line->>'credit')::numeric, 0), coalesce(v_line->>'memo', ''),
      nullif(v_line->>'partner_id', '')::uuid);
  end loop;
  update journal_entries set entry_date = p_entry_date, vat_type = p_vat_type,
    supply_amount = coalesce(p_supply_amount, 0), vat_amount = coalesce(p_vat_amount, 0),
    description = coalesce(p_description, description),
    is_electronic = (coalesce(v_e.reference_type, '') = 'tax_invoice') or coalesce(p_electronic, v_e.is_electronic, false),
    reviewed_by = v_uid, reviewed_at = now(), updated_at = now()
  where id = p_entry_id;
  if coalesce(v_e.reference_type, '') in ('', 'stock_doc') then
    select (x->>'partner_id')::uuid into v_doc_partner from jsonb_array_elements(p_lines) x where coalesce(x->>'partner_id', '') <> '' limit 1;
    if p_vat_type in ('11','12','13') then
      update tax_invoices t set issue_date = p_entry_date, partner_id = p2.id, counterparty_name = coalesce(p2.name, ''),
        counterparty_bizno = p2.business_number, item_name = nullif(coalesce(p_description, ''), ''),
        supply_amount = coalesce(p_supply_amount, 0), tax_amount = coalesce(p_vat_amount, 0),
        total_amount = coalesce(p_supply_amount, 0) + coalesce(p_vat_amount, 0),
        tax_kind = case p_vat_type when '12' then 'zero_rated' when '13' then 'exempt' else 'taxable' end,
        doc_kind = case p_vat_type when '13' then 'exempt' else 'tax' end, updated_at = now()
      from (select 1) one left join partners p2 on p2.id = v_doc_partner and p2.company_id = v_company
      where t.journal_entry_id = p_entry_id and t.company_id = v_company and t.source = 'manual' and t.nts_issue_status = 'draft' and t.nts_confirm_no is null;
    else
      delete from tax_invoices t where t.journal_entry_id = p_entry_id and t.company_id = v_company and t.source = 'manual' and t.nts_issue_status = 'draft' and t.nts_confirm_no is null;
    end if;
  end if;
end $$;

-- ── 화면이 직접 UPDATE 하던 두 행위를 RPC 로 ─────────────────────────────────
--   장부 제외: 전표 없이 '끝난 것'으로 표시. 권한·회사·마감월을 확인하고, 전표가 있는 건은 못 바꾼다.
create or replace function public.set_ledger_excluded(p_kind text, p_ids uuid[], p_reason text default null)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := public.get_my_company_id(); v_n integer := 0; v_locked integer;
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  if not (public.is_company_admin() or public.has_perm('/collect')
          or public.has_perm('/partners/reconciliation/voucher-entry') or public.has_perm('/partners/reconciliation/sale-purchase')) then raise exception 'FORBIDDEN'; end if;
  if p_kind not in ('bank', 'card') then raise exception 'INVALID_KIND'; end if;
  if p_ids is null or array_length(p_ids, 1) is null then return 0; end if;
  if p_kind = 'bank' then
    select count(*) into v_locked from bank_transactions t join closing_checklists cc
      on cc.company_id = t.company_id and cc.month = to_char(t.transaction_date, 'YYYY-MM') and cc.status = 'locked'
      where t.company_id = v_company and t.id = any(p_ids);
    if v_locked > 0 then raise exception 'PERIOD_LOCKED'; end if;
    update bank_transactions set ledger_excluded_reason = p_reason
      where company_id = v_company and id = any(p_ids) and (p_reason is null or journal_entry_id is null);
  else
    select count(*) into v_locked from card_transactions t join closing_checklists cc
      on cc.company_id = t.company_id and cc.month = to_char(t.transaction_date, 'YYYY-MM') and cc.status = 'locked'
      where t.company_id = v_company and t.id = any(p_ids);
    if v_locked > 0 then raise exception 'PERIOD_LOCKED'; end if;
    update card_transactions set ledger_excluded_reason = p_reason
      where company_id = v_company and id = any(p_ids) and (p_reason is null or journal_entry_id is null);
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.set_ledger_excluded(text, uuid[], text) from public, anon;
grant execute on function public.set_ledger_excluded(text, uuid[], text) to authenticated, service_role;

--   기존 전표에 연결: 원거래를 이미 있는 확정 전표에 건다(전표는 안 만든다). 같은 회사·확정 전표·미연결 거래만.
create or replace function public.link_transaction_to_entry(p_kind text, p_tx_id uuid, p_entry_id uuid)
returns boolean language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid := public.get_my_company_id(); v_uid uuid; v_e record; v_date date; v_n integer := 0;
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  if not (public.is_company_admin() or public.has_perm('/collect')
          or public.has_perm('/partners/reconciliation/voucher-entry') or public.has_perm('/partners/reconciliation/sale-purchase')) then raise exception 'FORBIDDEN'; end if;
  if p_kind not in ('bank', 'card', 'cash_receipt', 'tax_invoice', 'stock_doc') then raise exception 'INVALID_KIND'; end if;
  select * into v_e from journal_entries where id = p_entry_id and company_id = v_company;
  if v_e.id is null or v_e.status <> 'confirmed' then raise exception 'NOT_FOUND_OR_INVALID'; end if;
  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;
  if p_kind = 'bank' then
    select transaction_date into v_date from bank_transactions where id = p_tx_id and company_id = v_company;
    if v_date is null then raise exception 'NOT_FOUND'; end if;
    perform public._voucher_assert_open(v_company, v_date);
    update bank_transactions set journal_entry_id = p_entry_id, mapping_status = 'manual_mapped', mapped_by = v_uid, mapped_at = now()
      where id = p_tx_id and company_id = v_company and journal_entry_id is null;
  elsif p_kind = 'card' then
    select transaction_date into v_date from card_transactions where id = p_tx_id and company_id = v_company;
    if v_date is null then raise exception 'NOT_FOUND'; end if;
    perform public._voucher_assert_open(v_company, v_date);
    update card_transactions set journal_entry_id = p_entry_id, mapping_status = 'manual_mapped', mapped_by = v_uid, mapped_at = now()
      where id = p_tx_id and company_id = v_company and journal_entry_id is null;
  elsif p_kind = 'cash_receipt' then
    select issue_date into v_date from cash_receipts where id = p_tx_id and company_id = v_company;
    if v_date is null then raise exception 'NOT_FOUND'; end if;
    perform public._voucher_assert_open(v_company, v_date);
    update cash_receipts set journal_entry_id = p_entry_id where id = p_tx_id and company_id = v_company and journal_entry_id is null;
  elsif p_kind = 'tax_invoice' then
    select issue_date into v_date from tax_invoices where id = p_tx_id and company_id = v_company;
    if v_date is null then raise exception 'NOT_FOUND'; end if;
    perform public._voucher_assert_open(v_company, v_date);
    update tax_invoices set journal_entry_id = p_entry_id where id = p_tx_id and company_id = v_company and journal_entry_id is null;
  else
    select doc_date into v_date from stock_docs where id = p_tx_id and company_id = v_company;
    if v_date is null then raise exception 'NOT_FOUND'; end if;
    perform public._voucher_assert_open(v_company, v_date);
    update stock_docs set journal_entry_id = p_entry_id where id = p_tx_id and company_id = v_company and journal_entry_id is null;
  end if;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.link_transaction_to_entry(text, uuid, uuid) from public, anon;
grant execute on function public.link_transaction_to_entry(text, uuid, uuid) to authenticated, service_role;

-- ── 카드 중복 방지: 어느 카드로 긁었는지도 본다 ─────────────────────────────
--   직원 둘이 같은 날 같은 가맹점에서 각자 법인카드로 같은 금액을 결제하면 한 건이 조용히 사라졌다.
--   승인내역·청구내역 모두 card_id 가 있으므로 열쇠에 넣어도 두 출처 사이의 중복 제거는 그대로 된다.
create or replace function public.card_tx_prevent_dup()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $$
begin
  if exists (
    select 1 from public.card_transactions c
    where c.company_id = new.company_id
      and c.transaction_date = new.transaction_date
      and c.amount = new.amount
      and coalesce(c.card_id::text, c.card_name, '') = coalesce(new.card_id::text, new.card_name, '')
      and public.card_merchant_key(c.merchant_name) = public.card_merchant_key(new.merchant_name)
      and (coalesce(c.approval_number, '') = coalesce(new.approval_number, '')
           or coalesce(c.approval_number, '') = '' or coalesce(new.approval_number, '') = '')
  ) then
    return null;
  end if;
  return new;
end $$;

-- 내부 규칙 함수는 RPC 로 노출하지 않는다
revoke all on function public._voucher_assert_open(uuid, date) from public, anon, authenticated;
revoke all on function public._next_voucher_no(uuid, date) from public, anon, authenticated;
revoke all on function public._voucher_audit(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public._voucher_unlink_all(uuid, uuid) from public, anon, authenticated;
revoke all on function public._voucher_check_lines(uuid, jsonb) from public, anon, authenticated;
commit;
