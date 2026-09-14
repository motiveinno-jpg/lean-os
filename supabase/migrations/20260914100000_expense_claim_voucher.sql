-- 결재 경비 → 전표 연결 (1차)
--
--   결재 허브에서 승인된 지출결의서가 수집·전표 > 결재 경비 탭에 줄로 올라오고, 경리가 '전표 만들기'를
--   눌러야 일반전표가 된다. 승인 자체는 장부에 아무것도 쓰지 않는다.
--
--   · approval_forms.is_expense      — 관리자가 '경비 양식'으로 표시한 양식만 대상. 기본 false 라 켜기 전엔 아무 일도 없다.
--   · approval_requests.paid_by      — 'personal'(직원 개인 돈) | 'corporate_card'(법인카드). 전표는 personal 만 만든다.
--                                      법인카드는 카드 수집이 이미 장부에 올린 돈이라 여기서 또 만들면 이중 기장이다.
--   · approval_requests.expense_account_id — 작성자가 고른 비용 계정(없으면 경리가 전표 만들 때 고른다).
--   · approval_requests.journal_entry_id   — 만들어진 전표. 카드거래·세금계산서의 journal_entry_id 와 같은 자리.
--   · save_manual_voucher 에 reference_type 'approval_request' 갈래 — 승인됨·경비 양식·personal·미전표 네 조건을
--     서버가 다시 검사한다(EXPENSE_NOT_ELIGIBLE). 화면이 잘못 눌러도 여기서 막힌다.
--   · _voucher_unlink_all 에 approval_requests 풀기 — 전표를 취소하면 다시 '전표 대기'로 돌아온다.

alter table public.approval_forms
  add column if not exists is_expense boolean not null default false;

alter table public.approval_requests
  add column if not exists paid_by text,
  add column if not exists expense_account_id uuid references public.chart_of_accounts(id) on delete set null,
  add column if not exists journal_entry_id uuid references public.journal_entries(id) on delete set null;

alter table public.approval_requests drop constraint if exists approval_requests_paid_by_check;
alter table public.approval_requests
  add constraint approval_requests_paid_by_check
  check (paid_by is null or paid_by in ('personal', 'corporate_card'));

create index if not exists approval_requests_journal_entry_idx
  on public.approval_requests (journal_entry_id) where journal_entry_id is not null;

-- ── 전표 저장: 결재 경비 갈래 추가 (나머지는 20260910140000 그대로) ─────────────────────────────
create or replace function public.save_manual_voucher(
  p_entry_date date, p_voucher_type text, p_description text, p_lines jsonb,
  p_reference_type text default null, p_reference_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  if p_reference_type is not null and p_reference_type not in ('bank_transaction','card_transaction','cash_receipt','tax_invoice','approval_request') then
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
    -- 결재 경비: 승인됨 · 경비 양식 · 직원 개인 돈 · 아직 전표 없음 — 넷 중 하나라도 아니면 만들지 않는다
    if p_reference_type = 'approval_request' then
      if exists (select 1 from approval_requests r where r.id = p_reference_id and r.company_id = v_company and r.journal_entry_id is not null) then
        raise exception 'ALREADY_POSTED';
      end if;
      if not exists (
        select 1 from approval_requests r
          join approval_forms f on f.id = r.form_id and f.company_id = r.company_id
         where r.id = p_reference_id and r.company_id = v_company
           and r.status = 'approved' and f.is_expense = true and r.paid_by = 'personal'
      ) then raise exception 'EXPENSE_NOT_ELIGIBLE'; end if;
    end if;
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
    elsif p_reference_type = 'approval_request' then
      -- updated_at 은 건드리지 않는다 — 화면이 승인일로 읽는 값이다
      update approval_requests set journal_entry_id = v_entry_id where id = p_reference_id and company_id = v_company;
    end if;
  end if;
  return v_entry_id;
end $function$;

-- ── 전표 취소 시 원자료 풀기: 결재 경비도 다시 '전표 대기'로 ────────────────────────────────────
create or replace function public._voucher_unlink_all(p_company uuid, p_entry_id uuid)
returns text
language plpgsql
set search_path to 'public'
as $function$
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
  update approval_requests set journal_entry_id = null where company_id = p_company and journal_entry_id = p_entry_id;
  if found then v_freed := 'approval_request'; end if;
  return v_freed;
end $function$;
