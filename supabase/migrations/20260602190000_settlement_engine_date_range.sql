-- 채권 대사 매칭 엔진 — 기간 지정형으로 변경 (504 커넥션 고갈 방지).
-- 기존 p_days(3년=5천건 한방)는 커넥션을 170s 보유 → 슬롯 고갈로 504 유발.
-- 변경: [p_start, p_end] 기간(최대 6개월=186일)만 처리 → 호출당 짧게 끝남.
--   ON CONFLICT DO NOTHING 이라 여러 기간 반복 호출해도 기존 제안 유지·누적(중복 없음).
--   statement_timeout 60s 로 하향(6개월 분량은 빠름, 장시간 커넥션 보유 차단).
drop function if exists public.generate_settlement_suggestions(int);

create or replace function public.generate_settlement_suggestions(p_start date, p_end date)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = '60s'
as $$
declare
  v_company uuid;
  v_tx record;
  v_inv record;
  v_pid uuid;
  v_norm text;
  v_remaining numeric;
  v_withheld numeric;
  v_suggested int := 0;
  v_resolved int := 0;
begin
  v_company := public.get_my_company_id();
  if v_company is null then raise exception '권한이 없습니다.'; end if;
  -- 6개월(186일) 초과 방지 — 커넥션 장기 보유 차단
  if p_start is null or p_end is null then raise exception '기간을 지정하세요.'; end if;
  if p_end - p_start > 186 then p_start := p_end - 186; end if;

  for v_tx in
    select bt.id, bt.amount, bt.transaction_date, bt.counterparty, bt.type, bt.partner_id
    from bank_transactions bt
    where bt.company_id = v_company
      and bt.settlement_status = 'open'
      and bt.type in ('income','expense')
      and bt.transaction_date >= p_start and bt.transaction_date <= p_end
      and coalesce(bt.amount,0) > 0
  loop
    v_norm := public.normalize_party_name(v_tx.counterparty);
    if v_norm = '' then continue; end if;

    v_pid := v_tx.partner_id;
    if v_pid is null then
      select pa.partner_id into v_pid from partner_aliases pa
      where pa.company_id = v_company and public.normalize_party_name(pa.alias) = v_norm limit 1;
    end if;
    if v_pid is null then
      select p.id into v_pid from partners p
      where p.company_id = v_company and public.normalize_party_name(p.name) = v_norm limit 1;
    end if;
    if v_pid is null then
      select p.id into v_pid from partners p
      where p.company_id = v_company and p.representative is not null
        and public.normalize_party_name(p.representative) = v_norm limit 1;
    end if;

    if v_pid is null then continue; end if;
    v_resolved := v_resolved + 1;
    if v_tx.partner_id is null then
      update bank_transactions set partner_id = v_pid where id = v_tx.id;
    end if;

    for v_inv in
      select ti.id, ti.total_amount, ti.supply_amount, ti.settled_amount, ti.issue_date
      from tax_invoices ti
      where ti.company_id = v_company and ti.partner_id = v_pid
        and ti.settlement_status <> 'settled'
        and ti.type = case when v_tx.type='income' then 'sales' else 'purchase' end
        and ti.issue_date <= v_tx.transaction_date
      order by ti.issue_date
    loop
      v_remaining := coalesce(v_inv.total_amount,0) - coalesce(v_inv.settled_amount,0);
      if v_remaining <= 0 then continue; end if;
      v_withheld := v_remaining - round(coalesce(v_inv.supply_amount,0) * 0.033);

      if abs(v_tx.amount - v_remaining) <= 1000 then
        insert into invoice_settlements(company_id, bank_transaction_id, tax_invoice_id, amount, match_type, match_source, status, confidence, reason)
        values (v_company, v_tx.id, v_inv.id, least(v_tx.amount, v_remaining), 'one_to_one','rule','suggested', 0.92, '정확 금액 일치')
        on conflict (bank_transaction_id, tax_invoice_id) do nothing;
        v_suggested := v_suggested + 1; exit;
      elsif coalesce(v_inv.supply_amount,0) > 0 and abs(v_tx.amount - v_withheld) <= 1000 then
        insert into invoice_settlements(company_id, bank_transaction_id, tax_invoice_id, amount, match_type, match_source, status, confidence, reason)
        values (v_company, v_tx.id, v_inv.id, v_tx.amount, 'withholding','rule','suggested', 0.8, '원천징수 3.3% 공제 추정')
        on conflict (bank_transaction_id, tax_invoice_id) do nothing;
        v_suggested := v_suggested + 1; exit;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('resolved', v_resolved, 'suggested', v_suggested);
end;
$$;

revoke execute on function public.generate_settlement_suggestions(date, date) from public, anon;
grant execute on function public.generate_settlement_suggestions(date, date) to authenticated;
