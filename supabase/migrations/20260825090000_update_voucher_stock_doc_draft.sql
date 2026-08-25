-- ── 재고 전표에서 만든 매출 전표를 고치면 계산서 초안도 같이 고친다 (2026-08-25, 3순위) ──
--
--   1순위 ①에서 재고 판매 전표 → 매출 전표 → 세금계산서 발행 대기 초안이 한 줄로 이어졌다.
--   그런데 수정 함수는 "증빙에서 온 전표(reference_type 있음)는 걸린 계산서가 원래 있던 증빙이라 안 건드린다"는
--   규칙 때문에 **재고 전표에서 온 전표의 초안도 안 고쳤다** — 금액을 고치면 초안이 옛 금액으로 남았다(1순위 커밋에 적어 둔 구멍).
--   ★ stock_doc 은 증빙이 아니라 **우리가 만든 초안**이 걸려 있으므로, 손으로 친 것과 같이 고친다.
--   바꾼 것: 조건 한 줄 — coalesce(reference_type,'') = ''  →  in ('', 'stock_doc').

create or replace function public.update_sale_purchase_voucher(
  p_entry_id uuid, p_entry_date date, p_vat_type text, p_supply_amount numeric, p_vat_amount numeric,
  p_description text, p_lines jsonb, p_electronic boolean default null
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
    is_electronic = (coalesce(v_e.reference_type, '') = 'tax_invoice') or coalesce(p_electronic, v_e.is_electronic, false),
    reviewed_by = v_uid,
    reviewed_at = now(),
    updated_at = now()
  where id = p_entry_id;

  -- 이 전표가 만든 발행 대기 문서(draft·미전송)만 같이 고친다.
  -- 증빙(세금계산서·카드·현금영수증)에서 온 전표는 걸린 행이 원래 있던 증빙이라 건너뛴다.
  -- ★ 재고 전표(stock_doc)에서 온 전표는 우리가 만든 초안이 걸려 있으므로 손으로 친 것과 같이 고친다 (2026-08-25).
  if coalesce(v_e.reference_type, '') in ('', 'stock_doc') then
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
