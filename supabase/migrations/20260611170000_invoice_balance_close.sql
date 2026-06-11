-- 2026-06-11 거래처 원장 "차액 마감"(adjustment settlement) DB 레이어.
--   배경: 세금계산서 금액 != 입금액(수수료/단수차/원천징수/할인) 차액이 영원히 미정산 잔액으로 남음.
--   해결: invoice_settlements 에 통장거래 없는 조정 정산행(match_type='adjustment', bank_transaction_id null)
--         을 confirmed 로 넣어 기존 trg_recalc_settlement 가 settled_amount 를 재계산해 계산서를 닫음.
--         취소(=status rejected) 시 자동 원복도 기존 트리거 메커니즘 재사용.
--   설계 가드: PG 함수 본문 한글 금지(영어 주석). RLS/권한은 SECURITY DEFINER 헬퍼
--             public.get_my_company_id() / public.is_company_admin() 재사용(users 인라인 서브쿼리 금지).
--   idempotent: 컬럼/제약 추가는 IF NOT EXISTS / DROP IF EXISTS 후 재생성.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) SCHEMA: bank_transaction_id nullable + adjustment_reason + match_type CHECK 확장
-- ─────────────────────────────────────────────────────────────────────────

-- 1a) adjustment 행은 통장거래가 없음 → bank_transaction_id NULL 허용.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='invoice_settlements'
      and column_name='bank_transaction_id' and is_nullable='NO'
  ) then
    execute 'alter table public.invoice_settlements alter column bank_transaction_id drop not null';
  end if;
end $$;

-- 1b) adjustment_reason: NULL 허용, 값은 5종으로 제한.
alter table public.invoice_settlements
  add column if not exists adjustment_reason text;

alter table public.invoice_settlements
  drop constraint if exists invoice_settlements_adjustment_reason_chk;
alter table public.invoice_settlements
  add constraint invoice_settlements_adjustment_reason_chk
  check (adjustment_reason is null
         or adjustment_reason in ('withholding_tax','fee','rounding','discount','other'));

-- 1c) match_type CHECK 가 있으면 'adjustment' 를 포함하도록 재생성.
--     기존 제약명을 모르므로 invoice_settlements 의 match_type 관련 CHECK 를 동적으로 찾아 교체.
do $$
declare
  v_con text;
begin
  select c.conname into v_con
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public' and t.relname = 'invoice_settlements'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%match_type%'
  limit 1;

  if v_con is not null then
    execute format('alter table public.invoice_settlements drop constraint %I', v_con);
  end if;

  -- Recreate a permissive but explicit allow-list including 'adjustment'.
  -- Values observed in engine + AI matcher: one_to_one, withholding, aggregate, partial, manual.
  alter table public.invoice_settlements
    add constraint invoice_settlements_match_type_chk
    check (match_type in ('one_to_one','withholding','aggregate','partial','manual','adjustment'));
exception
  when duplicate_object then null; -- constraint already present from a prior run
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) RPC close_invoice_balance — manual balance close (adjustment row).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.close_invoice_balance(
  p_invoice_id uuid,
  p_reason text,
  p_amount numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_inv_company uuid;
  v_total numeric;
  v_settled numeric;
  v_remaining numeric;
  v_amount numeric;
  v_id uuid;
begin
  -- Auth: caller company + owner/admin only (reuse SECURITY DEFINER helpers).
  v_company := public.get_my_company_id();
  if v_company is null then raise exception 'forbidden: no company'; end if;
  if not public.is_company_admin() then raise exception 'forbidden: admin only'; end if;

  -- Reason allow-list (mirrors the column CHECK).
  if p_reason is null or p_reason not in ('withholding_tax','fee','rounding','discount','other') then
    raise exception 'invalid reason: %', p_reason;
  end if;

  -- Load invoice and verify it belongs to caller company.
  select ti.company_id, coalesce(ti.total_amount,0), coalesce(ti.settled_amount,0)
    into v_inv_company, v_total, v_settled
  from tax_invoices ti
  where ti.id = p_invoice_id;

  if v_inv_company is null then raise exception 'invoice not found'; end if;
  if v_inv_company <> v_company then raise exception 'forbidden: cross-company'; end if;

  v_remaining := v_total - v_settled;
  v_amount := coalesce(p_amount, v_remaining);

  if v_remaining <= 0 then raise exception 'no remaining balance'; end if;
  if v_amount <= 0 or v_amount > v_remaining then
    raise exception 'amount out of range (0, %]', v_remaining;
  end if;

  -- Insert the adjustment settlement row. No bank transaction; trigger recalculates settled_amount.
  insert into invoice_settlements(
    company_id, bank_transaction_id, tax_invoice_id, amount,
    match_type, match_source, status, confidence, adjustment_reason, reason
  ) values (
    v_company, null, p_invoice_id, v_amount,
    'adjustment', 'manual', 'confirmed', 1, p_reason, 'manual balance close: ' || p_reason
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.close_invoice_balance(uuid, text, numeric) from public, anon;
grant execute on function public.close_invoice_balance(uuid, text, numeric) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) AUTO-CLOSE trigger — auto adjustment for small/withholding remainders,
--    and auto-reject of auto adjustments when a real match is un-confirmed.
--    Runs AFTER INSERT/UPDATE on invoice_settlements, per row.
--    Recursion terminates: adjustment rows (match_type='adjustment') are skipped,
--    and once remaining reaches 0 no further adjustment is inserted.
--    Order-independence: remaining is computed directly from confirmed settlement
--    rows (NOT from tax_invoices.settled_amount) so it does not depend on whether
--    trg_recalc_settlement fired before/after this trigger.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.trg_settlement_autoclose()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
  v_settled numeric;
  v_remaining numeric;
  v_supply numeric;
  v_wh numeric;
  v_company uuid;
begin
  -- Skip adjustment rows entirely -> guarantees recursion termination.
  if new.match_type = 'adjustment' then
    return null;
  end if;

  -- A) Un-confirm a real match: confirmed -> suggested/rejected.
  --    Auto-reject sibling AUTO adjustments on the same invoice. Manual closes are preserved.
  if tg_op = 'UPDATE'
     and old.status = 'confirmed'
     and new.status in ('suggested','rejected') then
    update invoice_settlements s
       set status = 'rejected'
     where s.tax_invoice_id = new.tax_invoice_id
       and s.match_type = 'adjustment'
       and s.match_source = 'auto'
       and s.status = 'confirmed';
    return null;
  end if;

  -- B) Only act when this real match is (or became) confirmed.
  if new.status <> 'confirmed' then
    return null;
  end if;

  -- Load invoice header (company/total/supply). settled_amount is intentionally
  -- ignored here and recomputed below for order-independence vs trg_recalc_settlement.
  select ti.company_id, coalesce(ti.total_amount,0), coalesce(ti.supply_amount,0)
    into v_company, v_total, v_supply
  from tax_invoices ti
  where ti.id = new.tax_invoice_id;

  if v_company is null then return null; end if;

  -- Recompute settled directly from confirmed settlement rows (this row included,
  -- since it is confirmed and already visible in AFTER trigger). Includes any
  -- adjustment rows already confirmed -> prevents double auto-close.
  select coalesce(sum(s.amount), 0) into v_settled
  from invoice_settlements s
  where s.tax_invoice_id = new.tax_invoice_id
    and s.status = 'confirmed';

  v_remaining := v_total - v_settled;
  if v_remaining <= 0 then return null; end if;

  -- B1) Withholding remainder: this row is a withholding match and remainder ~= 3.3% of supply.
  v_wh := round(v_supply * 0.033);
  if new.match_type = 'withholding'
     and v_supply > 0
     and abs(v_remaining - v_wh) <= 1000 then
    insert into invoice_settlements(
      company_id, bank_transaction_id, tax_invoice_id, amount,
      match_type, match_source, status, confidence, adjustment_reason, reason
    ) values (
      v_company, null, new.tax_invoice_id, v_remaining,
      'adjustment', 'auto', 'confirmed', 1, 'withholding_tax', 'auto balance close: withholding_tax'
    );
    return null;
  end if;

  -- B2) Small rounding remainder (1..1000 inclusive).
  if v_remaining >= 1 and v_remaining <= 1000 then
    insert into invoice_settlements(
      company_id, bank_transaction_id, tax_invoice_id, amount,
      match_type, match_source, status, confidence, adjustment_reason, reason
    ) values (
      v_company, null, new.tax_invoice_id, v_remaining,
      'adjustment', 'auto', 'confirmed', 1, 'rounding', 'auto balance close: rounding'
    );
    return null;
  end if;

  return null;
end;
$$;

-- Fire AFTER the recalc trigger so settled_amount is already current.
-- trg_recalc_settlement is BEFORE? -> name our trigger to sort after it alphabetically among AFTER triggers.
-- Recalc trigger fires per row on invoice_settlements; we depend on its committed effect on tax_invoices.
drop trigger if exists settlement_autoclose on public.invoice_settlements;
create trigger settlement_autoclose
  after insert or update on public.invoice_settlements
  for each row execute function public.trg_settlement_autoclose();

-- ─────────────────────────────────────────────────────────────────────────
-- 4) VIEW v_settlement_confirmed — LEFT JOIN bank_transactions so adjustment
--    rows (bank_transaction_id null, no transaction_date) are returned.
-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.v_settlement_confirmed
with (security_invoker = on) as
select s.id, s.company_id, s.bank_transaction_id, s.tax_invoice_id, s.amount,
       s.match_type, s.match_source, s.status, s.confidence, s.reason, s.created_by, s.created_at, s.updated_at,
       b.transaction_date, b.amount as txn_amount, b.counterparty, b.type as txn_type,
       i.issue_date, i.total_amount as invoice_amount, i.counterparty_name, i.type as invoice_type
from invoice_settlements s
left join bank_transactions b on b.id = s.bank_transaction_id
join tax_invoices i on i.id = s.tax_invoice_id
where s.status = 'confirmed';
