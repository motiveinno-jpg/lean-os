-- ── 재고 전표를 매입매출전표의 '증빙'으로 (2026-08-25 사장님 지시 — 1순위 ①) ──────
--
--   무엇을 기준으로 판단하는가 —
--     재고 메뉴에서 판매·구매를 저장하면 **재고만** 움직이고 장부는 그대로였다.
--     그러면 재고 메뉴는 회계와 따로 노는 별도 장부가 된다.
--   ★ 규칙 — 제안은 자동, 확정은 사람. 그래서 **전표를 자동으로 만들지 않는다.**
--     대신 재고 전표가 세금계산서·카드·현금영수증과 **같은 자리**(매입매출전표 › 증빙에서 불러오기)에
--     뜬다. 사람이 불러와 저장하는 순간 전표가 서고, 재고 전표에 journal_entry_id 가 걸려 목록에서 빠진다.
--   ★ 판매 전표로 만든 매출 전표는 **세금계산서 발행 대기 문서**까지 같이 만든다(2026-08-13 규칙 그대로).
--     판매 → 전표 → 계산서가 한 줄로 이어진다.
--   ★ 되돌리기(unpost)도 재고 전표를 풀어 준다 — 다시 불러올 수 있게.
--
--   바꾼 것: save_sale_purchase_voucher 에 reference_type 'stock_doc' 허용 + stock_docs.journal_entry_id 연결
--          + 거래처를 그 재고 전표에서 읽음 / unpost_evidence_voucher 에 stock_docs 해제.
--   stock_docs.journal_entry_id 칸은 1단계(20260825010000)에 이미 있다.

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
  if p_reference_type is not null and p_reference_type not in ('tax_invoice','card_transaction','cash_receipt','stock_doc') then
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
  --   ★ 재고 전표(판매·구매)에서 온 건 — 거래처는 그 전표에 적힌 것 (2026-08-25)
  if p_reference_type = 'stock_doc' and p_reference_id is not null then
    select d.partner_id into v_partner from stock_docs d
    where d.id = p_reference_id and d.company_id = v_company;
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
    elsif p_reference_type = 'stock_doc' then
      update stock_docs set journal_entry_id = v_entry_id where id = p_reference_id and company_id = v_company;
    end if;
  end if;

  --   ── 손으로 친 매출 세금계산서 → 발행 대기 문서 (2026-08-13, 이 마이그레이션의 핵심) ──
  --   ★ 재고 판매 전표에서 온 건도 발행 대기 문서를 만든다 — 판매 → 전표 → 세금계산서가 한 줄로 이어진다 (2026-08-25)
  if (p_reference_id is null or p_reference_type = 'stock_doc') and p_vat_type in ('11','12','13') then
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

create or replace function public.unpost_evidence_voucher(p_entry_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_company uuid := public.get_my_company_id();
  v_uid uuid; v_e record; v_freed text := '';
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  if not (public.is_company_admin()
          OR public.has_perm('/partners/reconciliation/voucher-entry')
          OR public.has_perm('/partners/reconciliation/sale-purchase')) then
    raise exception 'FORBIDDEN';
  end if;
  select * into v_e from journal_entries where id = p_entry_id and company_id = v_company;
  if v_e.id is null or v_e.status not in ('ai_suggested', 'confirmed') then
    raise exception 'NOT_FOUND_OR_INVALID';
  end if;
  if exists (select 1 from closing_checklists cc
             where cc.company_id = v_company and cc.month = to_char(v_e.entry_date, 'YYYY-MM')
               and cc.status = 'locked') then
    raise exception 'PERIOD_LOCKED';
  end if;
  update tax_invoices set journal_entry_id = null
    where company_id = v_company and journal_entry_id = p_entry_id;
  if found then v_freed := 'tax_invoice'; end if;
  update cash_receipts set journal_entry_id = null
    where company_id = v_company and journal_entry_id = p_entry_id;
  if found then v_freed := 'cash_receipt'; end if;
  update card_transactions
    set journal_entry_id = null, mapping_status = 'unmapped', mapped_by = null, mapped_at = null
    where company_id = v_company and journal_entry_id = p_entry_id;
  if found then v_freed := 'card'; end if;
  update bank_transactions set journal_entry_id = null
    where company_id = v_company and journal_entry_id = p_entry_id;
  if found then v_freed := 'bank'; end if;
  --   ★ 재고 전표도 풀어 준다 — 다시 '증빙에서 불러오기'에 뜬다 (2026-08-25)
  update stock_docs set journal_entry_id = null
    where company_id = v_company and journal_entry_id = p_entry_id;
  if found then v_freed := 'stock_doc'; end if;
  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;
  update journal_entries
    set status = 'rejected', is_approved = false,
        reviewed_by = v_uid, reviewed_at = now(), updated_at = now()
    where id = p_entry_id;
  return v_freed;
end;
$$;
