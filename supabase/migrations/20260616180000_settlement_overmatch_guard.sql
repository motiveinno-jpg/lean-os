-- 정산 중복 매칭 재발 방지 (2026-06-16 거래처원장 핸드오프)
--   증상: 한 통장 출금(LG유플러스 3/31, 58,800)이 서로 다른 세금계산서 2장에 확정 매칭 →
--         원장 지급 이중 표시 + 송장 과정산. 또 이미 확정된 송장이 다른 출금에 계속 추천됨.
--   1) BEFORE 가드: 확정 시 출금 과배분(BANK_TX_OVERMATCH)·송장 과정산(INVOICE_OVERSETTLE) 차단.
--   2) AFTER 정리: 한 건 확정되면 같은 송장의 다른 '제안' + 완납된 출금의 다른 '제안' 자동 반려.
--   3) 기존 데이터의 stale 제안 일괄 반려.
--   함수 본문은 한글 인코딩 손상 방지를 위해 ASCII 만 사용(에러코드는 클라이언트에서 한글 변환).

-- ── 1. 과배분/과정산 확정 차단 (BEFORE INSERT/UPDATE) ──
create or replace function public.prevent_settlement_overmatch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bt_amt numeric;
  v_inv_total numeric;
  v_sum numeric;
begin
  -- only guard rows that are (becoming) confirmed
  if new.status is distinct from 'confirmed' then
    return new;
  end if;

  -- a single bank transaction must not be allocated beyond its amount
  if new.bank_transaction_id is not null then
    select amount into v_bt_amt from bank_transactions where id = new.bank_transaction_id;
    select coalesce(sum(amount), 0) into v_sum
      from invoice_settlements
      where bank_transaction_id = new.bank_transaction_id and status = 'confirmed' and id <> new.id;
    if v_bt_amt is not null and (v_sum + coalesce(new.amount, 0)) > v_bt_amt + 1 then
      raise exception 'BANK_TX_OVERMATCH';
    end if;
  end if;

  -- an invoice must not be settled beyond its total
  if new.tax_invoice_id is not null then
    select total_amount into v_inv_total from tax_invoices where id = new.tax_invoice_id;
    select coalesce(sum(amount), 0) into v_sum
      from invoice_settlements
      where tax_invoice_id = new.tax_invoice_id and status = 'confirmed' and id <> new.id;
    if v_inv_total is not null and (v_sum + coalesce(new.amount, 0)) > v_inv_total + 1 then
      raise exception 'INVOICE_OVERSETTLE';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_settlement_prevent_overmatch on public.invoice_settlements;
create trigger trg_settlement_prevent_overmatch
  before insert or update on public.invoice_settlements
  for each row execute function public.prevent_settlement_overmatch();

-- ── 2. 확정 시 stale 제안 자동 정리 (AFTER INSERT/UPDATE, status=confirmed 일 때만) ──
create or replace function public.clear_stale_settlement_suggestions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bt_amt numeric;
  v_bt_sum numeric;
begin
  -- invoice side: once an invoice has a confirmed settlement, any other 'suggested'
  --   match for the same invoice is stale (one invoice is claimed by one confirmed flow).
  if new.tax_invoice_id is not null then
    update invoice_settlements
      set status = 'rejected', updated_at = now()
      where tax_invoice_id = new.tax_invoice_id and status = 'suggested' and id <> new.id;
  end if;

  -- bank side: only when the bank transaction is now fully allocated, drop its other
  --   'suggested' matches (preserve legitimate partial / one-to-many splits otherwise).
  if new.bank_transaction_id is not null then
    select amount into v_bt_amt from bank_transactions where id = new.bank_transaction_id;
    select coalesce(sum(amount), 0) into v_bt_sum
      from invoice_settlements
      where bank_transaction_id = new.bank_transaction_id and status = 'confirmed';
    if v_bt_amt is not null and v_bt_sum >= v_bt_amt then
      update invoice_settlements
        set status = 'rejected', updated_at = now()
        where bank_transaction_id = new.bank_transaction_id and status = 'suggested' and id <> new.id;
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_settlement_clear_stale on public.invoice_settlements;
create trigger trg_settlement_clear_stale
  after insert or update on public.invoice_settlements
  for each row when (new.status = 'confirmed')
  execute function public.clear_stale_settlement_suggestions();

-- ── 3. 기존 stale 제안 일괄 정리 (now-claimed invoices / fully-settled bank txns) ──
update invoice_settlements s
  set status = 'rejected', updated_at = now()
  where s.status = 'suggested'
    and exists (
      select 1 from invoice_settlements c
      where c.tax_invoice_id = s.tax_invoice_id and c.status = 'confirmed'
    );

update invoice_settlements s
  set status = 'rejected', updated_at = now()
  where s.status = 'suggested'
    and s.bank_transaction_id is not null
    and exists (
      select 1 from bank_transactions bt
      where bt.id = s.bank_transaction_id
        and (
          select coalesce(sum(amount), 0) from invoice_settlements c
          where c.bank_transaction_id = s.bank_transaction_id and c.status = 'confirmed'
        ) >= bt.amount
    );
