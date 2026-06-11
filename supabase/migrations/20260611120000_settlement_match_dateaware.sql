-- 2026-06-11 거래처 원장 매칭 엔진 개선: 날짜 근접성 반영 + 오래된 송장 오매칭 방지.
--   문제: 금액(±1000)만 맞으면 '가장 오래된' 미정산 송장을 0.92 고정 신뢰도로 매칭
--         → 6월 입금이 2월(또는 작년 5월) 송장에 92%로 붙는 오매칭.
--   수정: (1) 결제일에 가장 가까운(최근) 송장 우선  (2) 6개월 초과 송장 제외
--         (3) 날짜 차이로 신뢰도 산정(가까울수록 높게). 방향(입금=매출/출금=매입)은 기존대로 유지.

create or replace function public.generate_settlement_suggestions(p_start date, p_end date)
returns jsonb language plpgsql security definer set search_path to 'public' set statement_timeout to '60s'
as $function$
declare
  v_company uuid; v_tx record; v_inv record; v_pid uuid; v_norm text;
  v_remaining numeric; v_withheld numeric; v_gap int; v_dateconf numeric;
  v_suggested int := 0; v_resolved int := 0;
begin
  v_company := public.get_my_company_id();
  if v_company is null then raise exception '권한이 없습니다.'; end if;
  if p_start is null or p_end is null then raise exception '기간을 지정하세요.'; end if;
  if p_end - p_start > 186 then p_start := p_end - 186; end if;

  for v_tx in
    select bt.id, bt.amount, bt.transaction_date, bt.counterparty, bt.type, bt.partner_id
    from bank_transactions bt
    where bt.company_id = v_company and bt.settlement_status = 'open'
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
        and ti.issue_date >= v_tx.transaction_date - 186  -- 6개월 초과 송장 제외(오매칭 방지)
      order by ti.issue_date desc                          -- 결제일에 가장 가까운(최근) 송장 우선
    loop
      v_remaining := coalesce(v_inv.total_amount,0) - coalesce(v_inv.settled_amount,0);
      if v_remaining <= 0 then continue; end if;
      v_gap := v_tx.transaction_date - v_inv.issue_date;
      -- 날짜 근접성 기반 신뢰도(말일결제 관행 반영: 가까울수록 높음)
      v_dateconf := case when v_gap <= 45 then 0.95 when v_gap <= 75 then 0.82
                         when v_gap <= 120 then 0.65 else 0.5 end;
      v_withheld := v_remaining - round(coalesce(v_inv.supply_amount,0) * 0.033);

      if abs(v_tx.amount - v_remaining) <= 1000 then
        insert into invoice_settlements(company_id, bank_transaction_id, tax_invoice_id, amount, match_type, match_source, status, confidence, reason)
        values (v_company, v_tx.id, v_inv.id, least(v_tx.amount, v_remaining), 'one_to_one','rule','suggested', v_dateconf, format('정확 금액 일치 · %s일 경과', v_gap))
        on conflict (bank_transaction_id, tax_invoice_id) do nothing;
        v_suggested := v_suggested + 1; exit;
      elsif coalesce(v_inv.supply_amount,0) > 0 and abs(v_tx.amount - v_withheld) <= 1000 then
        insert into invoice_settlements(company_id, bank_transaction_id, tax_invoice_id, amount, match_type, match_source, status, confidence, reason)
        values (v_company, v_tx.id, v_inv.id, v_tx.amount, 'withholding','rule','suggested', round(v_dateconf * 0.85, 2), format('원천징수 3.3%% 공제 추정 · %s일 경과', v_gap))
        on conflict (bank_transaction_id, tax_invoice_id) do nothing;
        v_suggested := v_suggested + 1; exit;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('resolved', v_resolved, 'suggested', v_suggested);
end;
$function$;

-- 일회성 정리: 기존 rule+suggested(미확정) 매칭 중 6개월 초과는 삭제(새 엔진이 더는 만들지 않음),
--             나머지는 날짜기반 신뢰도/사유로 재계산. confirmed/manual/ai 는 건드리지 않음.
delete from invoice_settlements s
using bank_transactions bt, tax_invoices ti
where s.bank_transaction_id = bt.id and s.tax_invoice_id = ti.id
  and s.status = 'suggested' and s.match_source = 'rule'
  and (bt.transaction_date - ti.issue_date) > 186;

update invoice_settlements s
set confidence = round(
      (case when (bt.transaction_date - ti.issue_date) <= 45 then 0.95
            when (bt.transaction_date - ti.issue_date) <= 75 then 0.82
            when (bt.transaction_date - ti.issue_date) <= 120 then 0.65
            else 0.5 end)
      * (case when s.match_type = 'withholding' then 0.85 else 1 end), 2),
    reason = case when s.match_type = 'withholding'
                  then format('원천징수 3.3%% 공제 추정 · %s일 경과', (bt.transaction_date - ti.issue_date))
                  else format('정확 금액 일치 · %s일 경과', (bt.transaction_date - ti.issue_date)) end
from bank_transactions bt, tax_invoices ti
where s.bank_transaction_id = bt.id and s.tax_invoice_id = ti.id
  and s.status = 'suggested' and s.match_source = 'rule';
