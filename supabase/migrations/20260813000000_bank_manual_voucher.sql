-- 통장 줄을 **일반전표 한 장**으로 (2026-08-12 사장님 지시)
--
--   지시 그대로:
--     · "처리는 필요없고 전체 일반전표로 전송되게"
--     · "건별로 차/대변 계정과목 설정가능하도록"
--     · "차/대변 거래처 다르게 설정 (보통예금부분은 자동으로 입력해주기)"
--       입금시 차변 보통예금(통장) / 대변 거래계정과목(거래처)
--       출금시 차변 거래계정과목(거래처) / 대변 보통예금(통장)
--     · "적요칸 만들어서 직접 내용 입력할 수 있게 (회사 내부 용도 확인용)"
--
--   ★ 보통예금 쪽은 **서버가 붙인다**. 화면이 보내는 건 상대 계정·상대 거래처·적요뿐이다.
--     "자동으로 입력" 을 화면 신뢰에 맡기면 언젠가 어긋난다 — 방향(입금/출금)도 여기서 정한다.
--   ★ 통장 줄에도 **거래처를 건다**(그 계좌). 카드 미지급금에 카드사를 건 것과 같은 이유다 —
--     거래처원장에서 "이 통장으로 무엇이 오갔나"를 바로 볼 수 있어야 한다.
--     구조적 연결(journal_lines.bank_account_id)도 함께 남긴다.
--
--   기존 post_bank_voucher(계정 하나만 받아 거래처 없이 전표를 만들던 것)는 남겨 둔다 —
--   /bank 화면이 아직 쓴다. 수집·전표 통장 탭만 이 새 입구로 옮긴다.

-- ── 1) 통장 거래처 — 계좌 하나당 하나 ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.find_or_create_bank_partner(p_bank_account_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_company uuid := public.get_my_company_id();
  v_b record; v_name text; v_pid uuid;
begin
  if v_company is null or p_bank_account_id is null then return null; end if;
  select * into v_b from bank_accounts where id = p_bank_account_id and company_id = v_company;
  if v_b.id is null then return null; end if;

  --   '기업은행 운영계좌' 처럼 사람이 알아보는 이름. 별칭이 없으면 계좌번호 뒤 4자리.
  v_name := trim(coalesce(v_b.bank_name, '') || ' ' ||
    coalesce(nullif(trim(coalesce(v_b.alias, '')), ''), right(coalesce(v_b.account_number, ''), 4)));
  if v_name = '' then return null; end if;

  select id into v_pid from partners where company_id = v_company and trim(name) = v_name limit 1;
  if v_pid is not null then return v_pid; end if;

  insert into partners (company_id, name, type, notes)
  values (v_company, v_name, 'vendor', '통장 거래처 — 자동 등록')
  returning id into v_pid;
  return v_pid;
end;
$function$;

-- ── 2) 통장 한 줄 → 일반전표 한 장 ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_bank_manual_voucher(
  p_bank_tx_id uuid, p_account_id uuid, p_partner_id uuid DEFAULT NULL, p_memo text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_company uuid := public.get_my_company_id();
  v_uid uuid; v_tx record; v_bankacct uuid; v_bankpartner uuid; v_entry uuid;
  v_amt numeric; v_in boolean; v_memo text; v_no integer;
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  if not (public.is_company_admin()
          OR public.has_perm('/partners/reconciliation/voucher-entry')
          OR public.has_perm('/partners/reconciliation/sale-purchase')) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_tx from bank_transactions where id = p_bank_tx_id and company_id = v_company;
  if v_tx.id is null then raise exception 'NOT_FOUND'; end if;
  if v_tx.journal_entry_id is not null then raise exception 'ALREADY_POSTED'; end if;
  v_amt := abs(coalesce(v_tx.amount, 0));
  if v_amt = 0 then raise exception 'INVALID_AMOUNT'; end if;
  if exists (select 1 from closing_checklists cc where cc.company_id = v_company
             and cc.month = to_char(v_tx.transaction_date, 'YYYY-MM') and cc.status = 'locked') then
    raise exception 'PERIOD_LOCKED';
  end if;
  if p_account_id is null or not exists (
       select 1 from chart_of_accounts a where a.id = p_account_id and a.company_id = v_company) then
    raise exception 'INVALID_ACCOUNT';
  end if;

  --   방향은 **서버가 정한다** — type 이 단일 기준, 비어 있을 때만 부호를 본다(화면과 같은 규칙)
  v_in := case when coalesce(v_tx.type, '') <> '' then v_tx.type in ('income', 'deposit', 'in')
               else coalesce(v_tx.amount, 0) > 0 end;

  v_bankacct := public.find_account(v_company, '103', '보통예금');
  if v_bankacct is null then raise exception 'NO_BANK_ACCOUNT'; end if;
  v_bankpartner := public.find_or_create_bank_partner(v_tx.bank_account_id);

  --   적요 — 사람이 쓴 것이 먼저. 비면 통장 적요, 그것도 비면 입금자/출금처.
  v_memo := nullif(trim(coalesce(p_memo, '')), '');
  v_memo := coalesce(v_memo, nullif(trim(coalesce(v_tx.description, '')), ''),
                     nullif(trim(coalesce(v_tx.counterparty, '')), ''), '');

  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;
  select coalesce(max(voucher_no), 0) + 1 into v_no
  from journal_entries where company_id = v_company and entry_date = v_tx.transaction_date;

  insert into journal_entries (company_id, entry_date, description, source, status, is_approved,
    voucher_no, voucher_type, entry_kind, reference_type, reference_id,
    created_by, approved_by, reviewed_by, reviewed_at)
  values (v_company, v_tx.transaction_date, v_memo, 'manual', 'confirmed', true,
    v_no, case when v_in then 'cash_in' else 'cash_out' end, 'general', 'bank_transaction', v_tx.id,
    v_uid, v_uid, v_uid, now())
  returning id into v_entry;

  if v_in then
    --   입금: 차) 보통예금[통장] / 대) 거래계정[거래처]
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id, bank_account_id) values
      (v_entry, v_company, v_bankacct,  v_amt, 0, v_memo, v_bankpartner, v_tx.bank_account_id),
      (v_entry, v_company, p_account_id, 0, v_amt, v_memo, p_partner_id, null);
  else
    --   출금: 차) 거래계정[거래처] / 대) 보통예금[통장]
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id, bank_account_id) values
      (v_entry, v_company, p_account_id, v_amt, 0, v_memo, p_partner_id, null),
      (v_entry, v_company, v_bankacct,  0, v_amt, v_memo, v_bankpartner, v_tx.bank_account_id);
  end if;

  update bank_transactions
    set journal_entry_id = v_entry, mapping_status = 'manual_mapped', mapped_by = v_uid, mapped_at = now()
    where id = p_bank_tx_id;

  return v_entry;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.post_bank_manual_voucher(uuid, uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.post_bank_manual_voucher(uuid, uuid, uuid, text) IS
  '통장 한 줄 → 일반전표 한 장. 보통예금 쪽(계정·통장 거래처·계좌 연결)은 서버가 붙이고, 화면은 상대 계정·거래처·적요만 보낸다.';

--   ⚠️ 회사를 인자로 받는 통장 거래처 함수는 화면에 열지 않는다 — 카드 쪽에서 같은 구멍을 막았다.
REVOKE EXECUTE ON FUNCTION public.find_or_create_bank_partner(uuid) FROM anon;

-- ── 3) 취소(되돌리기)가 통장도 풀도록 이미 되어 있다 ───────────────────────
--   unpost_evidence_voucher 가 bank_transactions.journal_entry_id 를 푼다(20260812210000).
--   다만 mapping_status 는 카드만 되돌리고 있었다 — 통장도 같이 되돌린다.
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

  update bank_transactions
    set journal_entry_id = null, mapping_status = 'unmapped', mapped_by = null, mapped_at = null
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
