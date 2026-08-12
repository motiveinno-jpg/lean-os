-- 수집에서 만든 전표를 되돌린다 (2026-08-12 사장님 지시: "수집에서 전표처리한건 취소기능 추가해줘")
--
--   History: 수집·전표 화면 아래에 "만든 전표는 매입매출전표 메뉴에서 그대로 보이고,
--     **지우면 이 목록으로 되돌아옵니다**" 라고 적어 뒀는데 — 실제로는 안 돌아왔다.
--     전표를 지우는 길은 전표입력 화면의 `voucher_reject` 하나뿐인데, 그건 전표를
--     status='rejected' 로만 바꾸고 **원자료의 journal_entry_id 를 그대로 둔다**.
--     수집 목록은 `journal_entry_id is not null` 을 '처리됨'으로 보므로 영영 안 돌아온다.
--     되돌릴 방법이 아예 없었던 셈이다.
--
--   ★ 지우지 않고 **반려(rejected)** 로 둔다 — 재무제표는 confirmed 만 읽으니 합계에서 빠지고,
--     "이런 전표를 만들었다가 취소했다"는 사실은 남는다. 회계에서 장부를 말없이 지우면 안 된다.
--     (voucher_reject 와 같은 규칙. 마감된 달은 손대지 않는다.)

-- ── 1) 취소 = 전표 반려 + 원자료 연결 해제 ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.unpost_evidence_voucher(p_entry_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  --   원자료를 풀어 준다 — **journal_entry_id 로 찾는다**. reference_type 으로 찾으면
  --   '3. 일반'처럼 일반전표로 보낸 건(참조를 안 남긴다)을 놓친다.
  update tax_invoices set journal_entry_id = null
    where company_id = v_company and journal_entry_id = p_entry_id;
  if found then v_freed := 'tax_invoice'; end if;

  update cash_receipts set journal_entry_id = null
    where company_id = v_company and journal_entry_id = p_entry_id;
  if found then v_freed := 'cash_receipt'; end if;

  --   카드는 매핑 표시까지 처음으로 —  다시 고를 수 있어야 한다
  update card_transactions
    set journal_entry_id = null, mapping_status = 'unmapped', mapped_by = null, mapped_at = null
    where company_id = v_company and journal_entry_id = p_entry_id;
  if found then v_freed := 'card'; end if;

  update bank_transactions set journal_entry_id = null
    where company_id = v_company and journal_entry_id = p_entry_id;
  if found then v_freed := 'bank'; end if;

  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;
  update journal_entries
    set status = 'rejected', is_approved = false,
        reviewed_by = v_uid, reviewed_at = now(), updated_at = now()
    where id = p_entry_id;

  return v_freed;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.unpost_evidence_voucher(uuid) TO authenticated;

COMMENT ON FUNCTION public.unpost_evidence_voucher(uuid) IS
  '수집에서 만든 전표 되돌리기 — 전표는 반려(이력 보존), 원자료는 미처리로 풀어 목록에 다시 뜨게 한다.';

-- ── 2) 취소한 자료를 **다시** 전표로 만들 수 있게 ──────────────────────────
--   save_sale_purchase_voucher 의 ALREADY_POSTED 검사가 status 를 안 봐서,
--   반려된 전표가 있으면 같은 증빙으로 영영 다시 못 만들었다. 반려는 없는 것으로 친다.
CREATE OR REPLACE FUNCTION public.save_sale_purchase_voucher(p_entry_date date, p_vat_type text, p_supply_amount numeric, p_vat_amount numeric, p_description text, p_lines jsonb, p_reference_type text DEFAULT NULL::text, p_reference_id uuid DEFAULT NULL::uuid, p_electronic boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      --   화면이 보낸 것이 우선, 없으면 증빙에서 찾은 것
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

  return v_entry_id;
end;
$function$;
