-- 현금영수증 취소거래도 전표로 — 정상 전표의 반대 분개 (2026-08-12)
--
--   History: 이 함수는 늘 **양수 전표**만 만들었다. 그래서 세금·증빙 화면의 일괄 전표처리는
--     취소거래를 아예 못 고르게 막아 뒀고(isPosted 에 status='cancelled' 포함), 취소분은
--     전표 없이 남았다. 매출이 깎이지 않으니 부가세·손익이 틀린다.
--     (93b6ebc7 에서 화면·합계는 마이너스로 고쳤고, 여기서 전표까지 이어 붙인다.)
--
--   규칙 — src/lib/cash-receipts.ts 의 cashReceiptSign() 과 **같은 기준**이다:
--     · status='cancelled' AND source='hometax_sync'  → 홈택스가 준 **취소거래 행**.
--       원본 발행 건은 그대로 있고 이 행이 그것을 깎는다 → **반대 분개**(마이너스 전표).
--     · status='cancelled' (그 밖의 source) / status='void' → 우리가 없던 일로 만든 건.
--       깎을 원본이 따로 없다 → 전표를 만들지 않는다(CANCELLED_RECEIPT).
--
--   ★ 부호를 어떻게 표현하나: journal_lines 에 debit·credit >= 0 체크가 있어 음수를 못 넣는다.
--     그래서 **차/대를 뒤집어 절대값**으로 넣는다 — save_sale_purchase_voucher(수정세금계산서·
--     카드 취소)가 쓰는 규칙과 같다. 머리(journal_entries.supply_amount·vat_amount)에는
--     부호를 그대로 남긴다 — 신고 집계가 같은 유형에 음수로 합산되게.
--
--   적용 시점: 즉시. 기존 데이터: 손대지 않는다(이미 만든 전표는 그대로).

CREATE OR REPLACE FUNCTION public.post_cash_voucher(p_cash_receipt_id uuid, p_account_id uuid, p_remember boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_company uuid := public.get_my_company_id();
  v_uid uuid; v_r record; v_cash uuid; v_vatin uuid; v_vatout uuid; v_entry uuid;
  v_total numeric; v_net numeric; v_vat numeric; v_is_sales boolean; v_vat_type text; v_acct_name text;
  v_sign smallint; v_desc text;
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  if not (public.is_company_admin() OR public.has_perm('/partners/reconciliation/voucher-entry')
          OR public.has_perm('/partners/reconciliation/sale-purchase')) then raise exception 'FORBIDDEN'; end if;
  select * into v_r from cash_receipts where id = p_cash_receipt_id and company_id = v_company;
  if v_r.id is null then raise exception 'NOT_FOUND'; end if;
  if v_r.journal_entry_id is not null then raise exception 'ALREADY_POSTED'; end if;

  --   전표에 얼마로 들어가는가 — cashReceiptSign() 과 같은 기준
  v_sign := case
              when coalesce(v_r.status, 'issued') = 'void' then 0
              when coalesce(v_r.status, 'issued') <> 'cancelled' then 1
              when v_r.source = 'hometax_sync' then -1
              else 0
            end;
  if v_sign = 0 then raise exception 'CANCELLED_RECEIPT'; end if;

  v_total := coalesce(v_r.amount, v_r.supply_amount);
  v_net := coalesce(v_r.supply_amount, v_r.amount);
  if v_total is null or v_total = 0 then raise exception 'INVALID_AMOUNT'; end if;
  v_vat := greatest(coalesce(v_total, 0) - coalesce(v_net, 0), 0);
  if p_account_id is null or not exists (select 1 from chart_of_accounts a where a.id = p_account_id and a.company_id = v_company) then raise exception 'INVALID_ACCOUNT'; end if;
  select name into v_acct_name from chart_of_accounts where id = p_account_id;

  v_cash   := public.find_account(v_company, '101', '보통예금');
  v_vatin  := public.find_account(v_company, '135', '부가세대급금');
  v_vatout := public.find_account(v_company, '255', '부가세예수금');
  if v_cash is null then raise exception 'NO_CASH_ACCOUNT'; end if;

  v_is_sales := (v_r.type = 'income');
  v_vat_type := case when v_is_sales then '22'
                     when coalesce(v_acct_name, '') like '%접대비%' then '54'
                     else '61' end;

  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;

  --   취소거래는 전표 목록에서도 한눈에 보이게 적어 둔다
  v_desc := coalesce(v_r.counterparty_name, '') || case when v_sign < 0 then ' (취소거래)' else '' end;

  insert into journal_entries (company_id, entry_date, description, source, status, is_approved, deal_id,
    voucher_type, entry_kind, vat_type, supply_amount, vat_amount, reference_type, reference_id,
    voucher_no, created_by, approved_by, reviewed_by, reviewed_at)
  values (v_company, v_r.issue_date, v_desc, 'manual', 'confirmed', true, v_r.deal_id,
    case when v_is_sales then 'cash_in' else 'cash_out' end,
    'sale_purchase', v_vat_type, v_sign * v_net, v_sign * v_vat, 'cash_receipt', v_r.id,
    (select coalesce(max(voucher_no), 0) + 1 from journal_entries where company_id = v_company and entry_date = v_r.issue_date),
    v_uid, v_uid, v_uid, now()) returning id into v_entry;

  if v_is_sales then
    --   매출 — 현금이 들어오고 매출·부가세예수금이 선다
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description) values
      (v_entry, v_company, v_cash, v_total, 0, coalesce(v_r.counterparty_name, '')),
      (v_entry, v_company, p_account_id, 0, v_net, coalesce(v_r.counterparty_name, ''));
    if v_vat > 0 and v_vatout is not null then
      insert into journal_lines (entry_id, company_id, account_id, debit, credit, description)
      values (v_entry, v_company, v_vatout, 0, v_vat, '부가세예수금');
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

  --   ★ 취소거래 = 방금 만든 정상 전표의 **반대 분개**. 줄을 다시 짜지 않고 좌우만 뒤집는다.
  --     UPDATE 의 SET 우변은 모두 **바뀌기 전 값**으로 평가되므로 이 한 줄로 정확히 맞바뀐다.
  if v_sign < 0 then
    update journal_lines set debit = credit, credit = debit where entry_id = v_entry;
  end if;

  update cash_receipts set journal_entry_id = v_entry where id = p_cash_receipt_id;
  return v_entry;
end; $function$;
