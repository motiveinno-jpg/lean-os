-- 자동 정산: 통장 입출금이 같은 거래처의 미정산 세금계산서와 금액이 정확히 맞으면 사람 확인 없이 확정한다.
--   기존 엔진(generate_settlement_suggestions)은 '제안'까지만 만들어 누군가 확정해야 settled_amount 가 움직였다.
--   규칙: 거래처 해소(엔진과 같은 순서) → 방향이 맞는 계산서 중 발행일 ≤ 거래일 ≤ 발행일+186 · 잔액 = 금액(±1,000).
--         후보가 하나면 확정. 여러 개인데 잔액이 전부 같으면(월 정기 계산서) 가장 오래된 것부터(FIFO).
--         잔액이 서로 다른 후보가 섞이면 사람 판단으로 남긴다. 원천징수 추정(3.3%)은 자동 확정하지 않는다.
--   확정 행은 기존 트리거가 그대로 처리한다: settled_amount 재계산 · 잔액 자동 마감 · 정산 전표 · 다른 제안 정리.
--   실행 시점: ① bank_transactions INSERT 직후(행 트리거) ② 하루 두 번 크론 sweep(계산서가 입금보다 늦게 수집되는 경우).
--   게이트: feature_on('auto_settlement', company). 마감 잠긴 달(closing_checklists.status='locked')은 건드리지 않는다.
SET statement_timeout = '120000';

create or replace function public.auto_settle_bank_tx(p_tx uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tx record; v_pid uuid; v_norm text; v_inv record;
  v_n int; v_ndistinct int; v_gap int; v_invtype text;
begin
  select bt.id, bt.company_id, bt.amount, bt.transaction_date, bt.counterparty, bt.type, bt.partner_id, bt.settlement_status
    into v_tx from bank_transactions bt where bt.id = p_tx;
  if not found then return false; end if;
  if v_tx.settlement_status <> 'open' or v_tx.type not in ('income','expense') or coalesce(v_tx.amount,0) <= 0 then return false; end if;
  if not public.feature_on('auto_settlement', v_tx.company_id) then return false; end if;
  if exists (select 1 from invoice_settlements s where s.bank_transaction_id = p_tx and s.status = 'confirmed') then return false; end if;
  if exists (select 1 from closing_checklists cc
             where cc.company_id = v_tx.company_id and cc.month = to_char(v_tx.transaction_date, 'YYYY-MM') and cc.status = 'locked') then
    return false;
  end if;

  -- 거래처 해소 — 엔진과 같은 순서(partner_id → 별칭 → 거래처명 → 대표자명)
  v_pid := v_tx.partner_id;
  if v_pid is null then
    v_norm := public.normalize_party_name(v_tx.counterparty);
    if v_norm is null or v_norm = '' then return false; end if;
    select pa.partner_id into v_pid from partner_aliases pa
      where pa.company_id = v_tx.company_id and public.normalize_party_name(pa.alias) = v_norm limit 1;
    if v_pid is null then
      select p.id into v_pid from partners p
        where p.company_id = v_tx.company_id and public.normalize_party_name(p.name) = v_norm limit 1;
    end if;
    if v_pid is null then
      select p.id into v_pid from partners p
        where p.company_id = v_tx.company_id and p.representative is not null
          and public.normalize_party_name(p.representative) = v_norm limit 1;
    end if;
    if v_pid is null then return false; end if;
    update bank_transactions set partner_id = v_pid where id = p_tx and partner_id is null;
  end if;

  v_invtype := case when v_tx.type = 'income' then 'sales' else 'purchase' end;

  -- 후보 집계: 개수와 서로 다른 잔액 개수
  select count(*), count(distinct round(coalesce(ti.total_amount,0) - coalesce(ti.settled_amount,0)))
    into v_n, v_ndistinct
  from tax_invoices ti
  where ti.company_id = v_tx.company_id and ti.partner_id = v_pid
    and ti.type = v_invtype and ti.status not in ('void','draft')
    and ti.settlement_status <> 'settled'
    and ti.issue_date <= v_tx.transaction_date and ti.issue_date >= v_tx.transaction_date - 186
    and abs(v_tx.amount - (coalesce(ti.total_amount,0) - coalesce(ti.settled_amount,0))) <= 1000
    and coalesce(ti.total_amount,0) - coalesce(ti.settled_amount,0) > 0
    and not exists (select 1 from invoice_settlements s where s.tax_invoice_id = ti.id and s.status = 'confirmed' and s.match_type <> 'adjustment')
    and not exists (select 1 from invoice_settlements s where s.tax_invoice_id = ti.id and s.bank_transaction_id = p_tx and s.status = 'rejected');
  if v_n = 0 then return false; end if;
  if v_n > 1 and v_ndistinct > 1 then return false; end if;

  -- FIFO: 가장 오래된 계산서
  select ti.id, coalesce(ti.total_amount,0) - coalesce(ti.settled_amount,0) as remaining, ti.issue_date
    into v_inv
  from tax_invoices ti
  where ti.company_id = v_tx.company_id and ti.partner_id = v_pid
    and ti.type = v_invtype and ti.status not in ('void','draft')
    and ti.settlement_status <> 'settled'
    and ti.issue_date <= v_tx.transaction_date and ti.issue_date >= v_tx.transaction_date - 186
    and abs(v_tx.amount - (coalesce(ti.total_amount,0) - coalesce(ti.settled_amount,0))) <= 1000
    and coalesce(ti.total_amount,0) - coalesce(ti.settled_amount,0) > 0
    and not exists (select 1 from invoice_settlements s where s.tax_invoice_id = ti.id and s.status = 'confirmed' and s.match_type <> 'adjustment')
    and not exists (select 1 from invoice_settlements s where s.tax_invoice_id = ti.id and s.bank_transaction_id = p_tx and s.status = 'rejected')
  order by ti.issue_date asc, ti.id asc
  limit 1;

  v_gap := v_tx.transaction_date - v_inv.issue_date;
  insert into invoice_settlements(company_id, bank_transaction_id, tax_invoice_id, amount, match_type, match_source, status, confidence, reason)
  values (v_tx.company_id, p_tx, v_inv.id, least(v_tx.amount, v_inv.remaining), 'one_to_one', 'auto', 'confirmed', 0.95,
          format('자동 정산 · 금액 일치 · %s일 경과', v_gap))
  on conflict (bank_transaction_id, tax_invoice_id) do update
    set status = 'confirmed', match_source = 'auto', amount = excluded.amount, reason = excluded.reason, updated_at = now()
    where invoice_settlements.status in ('suggested','needs_review');
  return true;
exception when others then
  -- 자동 정산 실패는 입출금 저장이나 sweep 전체를 막지 않는다
  raise warning 'auto_settle_bank_tx(%) skipped: %', p_tx, sqlerrm;
  return false;
end
$function$;

create or replace function public.auto_settle_company(p_company uuid, p_from date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_from date := coalesce(p_from, current_date - 190);
  v_id uuid; v_scanned int := 0; v_confirmed int := 0;
begin
  if p_company is null then return jsonb_build_object('scanned', 0, 'confirmed', 0); end if;
  if not public.feature_on('auto_settlement', p_company) then return jsonb_build_object('scanned', 0, 'confirmed', 0, 'skipped', 'feature_off'); end if;
  for v_id in
    select bt.id from bank_transactions bt
    where bt.company_id = p_company and bt.settlement_status = 'open'
      and bt.type in ('income','expense') and coalesce(bt.amount,0) > 0
      and bt.transaction_date >= v_from
    order by bt.transaction_date asc, bt.id asc   -- 오래된 입금부터 → FIFO 가 일관되게
  loop
    v_scanned := v_scanned + 1;
    if public.auto_settle_bank_tx(v_id) then v_confirmed := v_confirmed + 1; end if;
  end loop;
  return jsonb_build_object('scanned', v_scanned, 'confirmed', v_confirmed, 'from', v_from);
end
$function$;

-- 크론용: 게이트가 켜진 회사 전부 sweep
create or replace function public.run_auto_settlement()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_c record; v_out jsonb := '[]'::jsonb; v_r jsonb;
begin
  for v_c in select c.id from companies c where public.feature_on('auto_settlement', c.id) loop
    v_r := public.auto_settle_company(v_c.id);
    if coalesce((v_r->>'confirmed')::int, 0) > 0 then
      v_out := v_out || jsonb_build_object('company', v_c.id, 'confirmed', v_r->'confirmed');
    end if;
  end loop;
  return v_out;
end
$function$;

-- 입출금이 들어오는 즉시 — 다른 통장 트리거(계좌 연결·거래처 보정) 뒤에 돌도록 이름을 zzz 로
create or replace function public.trg_bank_tx_auto_settle()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.auto_settle_bank_tx(new.id);
  return null;
end
$function$;

drop trigger if exists zzz_bank_tx_auto_settle on public.bank_transactions;
create trigger zzz_bank_tx_auto_settle
  after insert on public.bank_transactions
  for each row
  when (new.type in ('income','expense') and coalesce(new.amount,0) > 0)
  execute function public.trg_bank_tx_auto_settle();

revoke all on function public.auto_settle_bank_tx(uuid) from public;
revoke all on function public.auto_settle_company(uuid, date) from public;
revoke all on function public.run_auto_settlement() from public;
grant execute on function public.auto_settle_company(uuid, date) to authenticated;

-- 하루 두 번, 통장 수집(00:10·09:10 UTC) 30분 뒤
do $$
begin
  if exists (select 1 from cron.job where jobname = 'auto-settlement-sweep') then
    perform cron.unschedule('auto-settlement-sweep');
  end if;
  perform cron.schedule('auto-settlement-sweep', '40 0,9 * * *', 'select public.run_auto_settlement();');
end $$;

-- 게이트: 모티브 + QA 시드 회사부터
insert into public.feature_rollout (feature, company_id, note) values
  ('auto_settlement', 'c361afb9-8a52-4cac-add9-8992f0f7c09c', '자동 정산 — 모티브 먼저'),
  ('auto_settlement', '4d2157e8-35a2-4a78-8c6d-c774475ab110', '자동 정산 — QA 시드 검증용')
on conflict do nothing;
