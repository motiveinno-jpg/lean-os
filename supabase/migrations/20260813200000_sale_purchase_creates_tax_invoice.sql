-- 매입매출전표에서 친 세금계산서 → 세금·증빙 '발행 대기'에 문서로 (2026-08-13 사장님 지시)
--
--   "매입매출전표에서 입력한 세금계산서 자료들이 세금증빙 메뉴에서 보이고,
--    홈택스로 전송을 누르면 홈택스로 전송되게."
--
--   지금까지 매입매출전표는 **전표만** 만들었다. 손으로 친 세금계산서는 tax_invoices 행이
--   없어 문서로 존재하지 않았고, 세금·증빙(발행 대기)에 나타날 수도, 전송할 수도 없었다.
--
--   ── 결정 ────────────────────────────────────────────────────────────────
--   ① 규칙: 문서를 만드는 조건은 둘 다 만족할 때만.
--      · p_reference_id 가 없다 = 손으로 새로 친 것.
--        (불러온 증빙이면 tax_invoices 에 이미 행이 있다 — 또 만들면 이중 문서다)
--      · vat_type 이 매출 세금계산서류다: 11 과세 / 12 영세 / 13 면세(계산서).
--        카드매출(17)·현금과세매출(22)은 세금계산서가 아니고, 매입(5x·61)은 상대가
--        발행하는 것이라 우리가 전송할 수 없다 — 문서를 만들지 않는다.
--   ② AS_IS ▶ TO_BE: 전표만 생김 ▶ 전표 + tax_invoices 초안
--      (source='manual' · nts_issue_status='draft' · journal_entry_id=이 전표).
--      journal_entry_id 를 걸어 두므로 수집·전표에서 '처리됨'으로 보인다 — 이중 전표 방지.
--   ③ 적용 시점: 이 함수 교체 이후 저장분부터.
--   ④ 기존 데이터: 소급 생성 안 한다 — 과거 수기 전표는 홈택스에서 직접 발행했을
--      가능성이 높아, 소급으로 초안을 만들면 이중 발행 사고의 씨앗이 된다.
--
--   수정(update): 전표를 고치면 **아직 안 보낸(draft) 문서만** 따라 고친다.
--   보낸 문서는 국세청에 있는 사실이라 건드리지 않는다 — 고치려면 수정세금계산서가 길이다.
--
--   거래처가 비어 있어도 문서는 만든다(counterparty_name '') — 발행 대기에 '거래처 없음'
--   으로 떠야 채워 넣을 수 있다. 숨기면 "왜 안 떠"가 된다.

create or replace function public.save_sale_purchase_voucher(
  p_entry_date date, p_vat_type text, p_supply_amount numeric, p_vat_amount numeric,
  p_description text, p_lines jsonb,
  p_reference_type text default null, p_reference_id uuid default null,
  p_electronic boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
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
  v_partner uuid;
  v_doc_partner uuid;
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  if not (public.is_company_admin()
          OR public.has_perm('/partners/reconciliation/voucher-entry')
          OR public.has_perm('/partners/reconciliation/sale-purchase')) then
    raise exception 'FORBIDDEN';
  end if;
  if p_vat_type is null or p_vat_type not in ('11','12','13','17','22','51','53','54','57','58','59','61') then
    raise exception 'INVALID_VAT_TYPE';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) < 2 then raise exception 'NEED_TWO_LINES'; end if;
  if p_reference_type is not null and p_reference_type not in ('tax_invoice','card_transaction','cash_receipt') then
    raise exception 'INVALID_REFERENCE';
  end if;

  if exists (
    select 1 from closing_checklists cc
    where cc.company_id = v_company and cc.month = to_char(p_entry_date, 'YYYY-MM') and cc.status = 'locked'
  ) then
    raise exception 'PERIOD_LOCKED';
  end if;

  --   ★ 반려된 전표는 없는 것으로 친다 — 취소한 뒤 다시 만들 수 있어야 한다 (2026-08-12)
  if p_reference_type is not null and p_reference_id is not null
     and exists (
       select 1 from journal_entries je
       where je.company_id = v_company and je.reference_type = p_reference_type
         and je.reference_id = p_reference_id and je.status <> 'rejected'
     ) then
    raise exception 'ALREADY_POSTED';
  end if;

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
  if v_debit <= 0 or v_debit <> v_credit then raise exception 'UNBALANCED'; end if;

  --   ★ 거래처 — 증빙(세금계산서)에서 찾아 둔다. 화면이 보낸 값이 있으면 그것을 쓴다.
  if p_reference_type = 'tax_invoice' and p_reference_id is not null then
    v_partner := public.resolve_partner_for_invoice(p_reference_id);
  end if;

  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;
  select coalesce(max(voucher_no), 0) + 1 into v_no
  from journal_entries where company_id = v_company and entry_date = p_entry_date;

  insert into journal_entries (
    company_id, entry_date, description, source, status, is_approved,
    voucher_no, voucher_type, entry_kind, vat_type, supply_amount, vat_amount,
    reference_type, reference_id, is_electronic,
    created_by, approved_by, reviewed_by, reviewed_at
  ) values (
    v_company, p_entry_date, coalesce(p_description, ''), 'manual', 'confirmed', true,
    v_no, 'transfer', 'sale_purchase', p_vat_type,
    coalesce(p_supply_amount, 0), coalesce(p_vat_amount, 0),
    p_reference_type, p_reference_id,
    (coalesce(p_reference_type, '') = 'tax_invoice') or coalesce(p_electronic, false),
    v_uid, v_uid, v_uid, now()
  ) returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id)
    values (
      v_entry_id, v_company,
      (v_line->>'account_id')::uuid,
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      coalesce(v_line->>'memo', ''),
      -- 화면이 보낸 것이 우선, 없으면 증빙에서 찾은 것
      coalesce(nullif(v_line->>'partner_id', '')::uuid, v_partner)
    );
  end loop;

  if p_reference_id is not null then
    if p_reference_type = 'tax_invoice' then
      update tax_invoices set journal_entry_id = v_entry_id where id = p_reference_id and company_id = v_company;
    elsif p_reference_type = 'card_transaction' then
      update card_transactions set journal_entry_id = v_entry_id where id = p_reference_id and company_id = v_company;
    elsif p_reference_type = 'cash_receipt' then
      update cash_receipts set journal_entry_id = v_entry_id where id = p_reference_id and company_id = v_company;
    end if;
  end if;

  --   ── 손으로 친 매출 세금계산서 → 발행 대기 문서 (2026-08-13, 이 마이그레이션의 핵심) ──
  if p_reference_id is null and p_vat_type in ('11','12','13') then
    --   전표 줄에 실린 거래처(화면이 모든 줄에 같은 거래처를 싣는다) — 첫 번째 것
    select (x->>'partner_id')::uuid into v_doc_partner
    from jsonb_array_elements(p_lines) x
    where coalesce(x->>'partner_id', '') <> '' limit 1;

    insert into tax_invoices (
      company_id, type, issue_date,
      partner_id, counterparty_name, counterparty_bizno,
      item_name, supply_amount, tax_amount, total_amount,
      tax_kind, doc_kind, status, source, nts_issue_status,
      journal_entry_id
    )
    select
      v_company, 'sales', p_entry_date,
      p.id, coalesce(p.name, ''), p.business_number,
      nullif(coalesce(p_description, ''), ''),
      coalesce(p_supply_amount, 0), coalesce(p_vat_amount, 0),
      coalesce(p_supply_amount, 0) + coalesce(p_vat_amount, 0),
      case p_vat_type when '12' then 'zero_rated' when '13' then 'exempt' else 'taxable' end,
      case p_vat_type when '13' then 'exempt' else 'tax' end,
      'draft', 'manual', 'draft',
      v_entry_id
    from (select 1) one
    left join partners p on p.id = v_doc_partner and p.company_id = v_company;
  end if;

  return v_entry_id;
end;
$$;

-- 전표를 고치면 **아직 안 보낸 문서만** 따라 고친다
create or replace function public.update_sale_purchase_voucher(
  p_entry_id uuid, p_entry_date date, p_vat_type text, p_supply_amount numeric,
  p_vat_amount numeric, p_description text, p_lines jsonb,
  p_electronic boolean default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
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
  v_doc_partner uuid;
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  if not (public.is_company_admin()
          OR public.has_perm('/partners/reconciliation/voucher-entry')
          OR public.has_perm('/partners/reconciliation/sale-purchase')) then
    raise exception 'FORBIDDEN';
  end if;
  if p_entry_date is null then raise exception 'NO_DATE'; end if;
  if p_vat_type is null or p_vat_type not in ('11','12','13','17','22','51','53','54','57','61') then
    raise exception 'INVALID_VAT_TYPE';
  end if;
  select * into v_e from journal_entries where id = p_entry_id and company_id = v_company;
  if v_e.id is null then raise exception 'NOT_FOUND'; end if;
  if coalesce(v_e.entry_kind, '') <> 'sale_purchase' then raise exception 'NOT_SALE_PURCHASE'; end if;
  if v_e.status <> 'confirmed' then raise exception 'NOT_FOUND_OR_INVALID'; end if;
  if exists (
    select 1 from closing_checklists cc
    where cc.company_id = v_company
      and cc.month in (to_char(v_e.entry_date, 'YYYY-MM'), to_char(p_entry_date, 'YYYY-MM'))
      and cc.status = 'locked'
  ) then
    raise exception 'PERIOD_LOCKED';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) < 2 then raise exception 'NEED_TWO_LINES'; end if;
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
  if v_debit <= 0 or v_debit <> v_credit then raise exception 'UNBALANCED'; end if;

  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;
  select jsonb_build_object(
    'entry_date', v_e.entry_date, 'description', v_e.description, 'vat_type', v_e.vat_type,
    'supply_amount', v_e.supply_amount, 'vat_amount', v_e.vat_amount, 'is_electronic', v_e.is_electronic,
    'lines', coalesce(jsonb_agg(jsonb_build_object(
      'account_id', jl.account_id, 'debit', jl.debit, 'credit', jl.credit,
      'partner_id', jl.partner_id, 'memo', jl.description
    ) order by jl.id), '[]'::jsonb)
  ) into v_before
  from journal_lines jl where jl.entry_id = p_entry_id;
  insert into journal_entry_audits (company_id, entry_id, action, actor_id, before)
  values (v_company, p_entry_id, 'update', v_uid, v_before);

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

  update journal_entries set
    entry_date = p_entry_date,
    vat_type = p_vat_type,
    supply_amount = coalesce(p_supply_amount, 0),
    vat_amount = coalesce(p_vat_amount, 0),
    description = coalesce(p_description, description),
    -- ★ coalesce 로 NULL 을 눕히고 비교. 증빙에서 온 건은 못 끄고,
    --    인자를 안 주면(null) 지금 값을 그대로 둔다.
    is_electronic = (coalesce(v_e.reference_type, '') = 'tax_invoice') or coalesce(p_electronic, v_e.is_electronic, false),
    reviewed_by = v_uid,
    reviewed_at = now(),
    updated_at = now()
  where id = p_entry_id;

  --   ── 이 전표가 만든 발행 대기 문서가 있으면 같이 고친다 (2026-08-13) ──
  --   ★ 아직 안 보낸(draft) 것만. 보낸 문서는 국세청에 있는 사실이라 안 건드린다.
  --   ★ 전표가 **증빙을 불러와 만든 것**(v_e.reference_type 있음)이면 통째로 건너뛴다 —
  --     그때 걸린 tax_invoices 행은 전표가 만든 문서가 아니라 원래 있던 증빙이다.
  --     매출 세금계산서류가 아니게 고쳤으면(예: 11 → 17 카드매출) 문서를 지운다 —
  --     세금계산서가 아닌 것을 발행 대기에 남겨 두면 잘못 전송된다.
  if coalesce(v_e.reference_type, '') = '' then
    select (x->>'partner_id')::uuid into v_doc_partner
    from jsonb_array_elements(p_lines) x
    where coalesce(x->>'partner_id', '') <> '' limit 1;

    if p_vat_type in ('11','12','13') then
      update tax_invoices t set
        issue_date = p_entry_date,
        partner_id = p2.id,
        counterparty_name = coalesce(p2.name, ''),
        counterparty_bizno = p2.business_number,
        item_name = nullif(coalesce(p_description, ''), ''),
        supply_amount = coalesce(p_supply_amount, 0),
        tax_amount = coalesce(p_vat_amount, 0),
        total_amount = coalesce(p_supply_amount, 0) + coalesce(p_vat_amount, 0),
        tax_kind = case p_vat_type when '12' then 'zero_rated' when '13' then 'exempt' else 'taxable' end,
        doc_kind = case p_vat_type when '13' then 'exempt' else 'tax' end,
        updated_at = now()
      from (select 1) one
      left join partners p2 on p2.id = v_doc_partner and p2.company_id = v_company
      where t.journal_entry_id = p_entry_id and t.company_id = v_company
        and t.source = 'manual' and t.nts_issue_status = 'draft' and t.nts_confirm_no is null;
    else
      delete from tax_invoices t
      where t.journal_entry_id = p_entry_id and t.company_id = v_company
        and t.source = 'manual' and t.nts_issue_status = 'draft' and t.nts_confirm_no is null;
    end if;
  end if;
end;
$$;
