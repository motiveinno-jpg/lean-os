-- 결정 271 (docs/20260928_PLAN_ecommerce_stage1.md) — 채널 정산 묶음 → 정산 전표 초안
--
-- 한 정산 묶음(channel_settlements.batch_id)에서 아직 전표가 없는 줄을 모아 전표 '초안' 하나를 만든다.
--   차) 통장 정산금 · 수수료(0 이면 생략) · 배송비(0 이면 생략)
--   대) 매출 = 판매금액 합(없으면 정산금+수수료+배송비)
--   판매금액과 (정산금+수수료+배송비)가 다르면 차액 계정으로 맞춘다(없으면 예외).
-- 확정은 사람이 전표 현황에서 한다 — 여기서는 status='ai_suggested', source='rule', entry_kind='general'
-- (make_payroll_voucher_draft / make_inventory_voucher_draft 와 같은 값). 감사 기록은 journal_entries 의
-- trg_audit_journal_entry 트리거가 남긴다. created_by 는 기존 전표 관행대로 users.id(auth_id 로 찾음).
-- 초안 두 함수와 달리 사용자가 날짜를 고르므로 save_manual_voucher 처럼 _voucher_assert_open 으로
-- 마감된 달을 막는다.

create or replace function public.make_my_channel_settlement_voucher(
  p_batch_id uuid,
  p_entry_date date,
  p_acct_bank uuid,
  p_acct_fee uuid,
  p_acct_ship uuid,
  p_acct_sales uuid,
  p_acct_diff uuid default null,
  p_description text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := public.get_my_company_id();
  v_uid uuid;
  n int := 0;
  v_sale numeric := 0; v_fee numeric := 0; v_ship numeric := 0; v_settle numeric := 0;
  v_credit_sales numeric; v_diff numeric;
  v_channels text; v_from date; v_to date;
  v_desc text; v_entry uuid; v_lines jsonb := '[]'::jsonb; v_line jsonb; v_tot record;
  r record;
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  if not (public.is_company_admin()
          or public.has_perm('/inventory/channels:write')
          or public.has_perm('/collect')) then
    raise exception 'FORBIDDEN';
  end if;
  if p_batch_id is null then raise exception '정산 묶음이 없습니다'; end if;
  perform public._voucher_assert_open(v_company, p_entry_date);

  if p_acct_bank is null or p_acct_fee is null or p_acct_ship is null or p_acct_sales is null then
    raise exception '통장·수수료·배송비·매출 계정을 모두 고르세요';
  end if;
  if exists (
    select 1 from unnest(array[p_acct_bank, p_acct_fee, p_acct_ship, p_acct_sales, p_acct_diff]) a(id)
     where a.id is not null
       and not exists (select 1 from chart_of_accounts c where c.id = a.id and c.company_id = v_company)
  ) then
    raise exception '계정이 이 회사 것이 아닙니다';
  end if;

  -- 같은 묶음을 두 사람이 동시에 눌러도 전표가 둘 생기지 않게 줄을 먼저 잠근다
  perform 1 from channel_settlements
   where company_id = v_company and batch_id = p_batch_id and journal_entry_id is null
   for update;

  select count(*), coalesce(sum(sale_amount), 0), coalesce(sum(fee_amount), 0),
         coalesce(sum(shipping_amount), 0), coalesce(sum(settle_amount), 0),
         string_agg(distinct channel, ', '), min(settled_at), max(settled_at)
    into n, v_sale, v_fee, v_ship, v_settle, v_channels, v_from, v_to
    from channel_settlements
   where company_id = v_company and batch_id = p_batch_id and journal_entry_id is null;
  if n = 0 then
    raise exception '전표를 만들 정산 줄이 없습니다(이미 전표가 있거나 묶음이 비어 있습니다)';
  end if;

  v_sale := round(v_sale); v_fee := round(v_fee); v_ship := round(v_ship); v_settle := round(v_settle);
  v_credit_sales := case when v_sale > 0 then v_sale else v_settle + v_fee + v_ship end;
  v_diff := v_credit_sales - (v_settle + v_fee + v_ship);
  if v_diff <> 0 and p_acct_diff is null then
    raise exception '판매금액과 정산 합이 ₩% 차이 납니다 — 차액 계정을 고르세요', to_char(v_diff, 'FM999,999,999,999');
  end if;

  v_desc := coalesce(nullif(btrim(p_description), ''),
    format('채널 정산 %s · %s~%s · %s건 · 정산금 ₩%s · 수수료 ₩%s · 배송비 ₩%s',
      v_channels, v_from, v_to, n,
      to_char(v_settle, 'FM999,999,999,999'), to_char(v_fee, 'FM999,999,999,999'), to_char(v_ship, 'FM999,999,999,999')));

  -- 부호 있는 금액: + 는 차변, - 는 대변, 0 은 줄 생략 (음수 정산 묶음도 줄이 뒤집혀 맞는다)
  for r in
    select * from (values
      (1, p_acct_bank,  v_settle,        '채널 정산금 입금'),
      (2, p_acct_fee,   v_fee,           '채널 수수료'),
      (3, p_acct_ship,  v_ship,          '채널 배송비'),
      (4, p_acct_diff,  v_diff,          '판매금액과 정산 차액'),
      (5, p_acct_sales, -v_credit_sales, '채널 매출')
    ) t(ord, acct, amt, memo)
    where amt <> 0
    order by ord
  loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', r.acct,
      'debit', greatest(r.amt, 0),
      'credit', greatest(-r.amt, 0),
      'memo', r.memo));
  end loop;
  select * into v_tot from public._voucher_check_lines(v_company, v_lines);

  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;

  insert into journal_entries (company_id, entry_date, description, entry_kind, source, status, voucher_type,
    is_approved, supply_amount, vat_amount, reference_type, reference_id, created_by)
  values (v_company, p_entry_date, v_desc, 'general', 'rule', 'ai_suggested', 'cash_in',
    false, 0, 0, 'channel_settlement_batch', p_batch_id, v_uid)
  returning id into v_entry;

  for v_line in select * from jsonb_array_elements(v_lines) loop
    insert into journal_lines (company_id, entry_id, account_id, debit, credit, description)
    values (v_company, v_entry, (v_line->>'account_id')::uuid,
      (v_line->>'debit')::numeric, (v_line->>'credit')::numeric, v_line->>'memo');
  end loop;

  update channel_settlements set journal_entry_id = v_entry
   where company_id = v_company and batch_id = p_batch_id and journal_entry_id is null;

  return v_entry;
end $$;

revoke all on function public.make_my_channel_settlement_voucher(uuid, date, uuid, uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.make_my_channel_settlement_voucher(uuid, date, uuid, uuid, uuid, uuid, uuid, text) to authenticated;
