-- 2026-06-11 정합성: 한 세금계산서에 서로 다른 입금이 중복 매칭·확정되어 과정산되는 버그 방지 + 기존 데이터 정정.
--   원인: generate_settlement_suggestions 가 '이미 제안/확정된 송장'을 거르지 않아, 동일 금액 입금 2건이
--         같은 송장에 각각 풀 매칭 → 둘 다 확정 시 settled_amount 가 총액의 2배(과정산).
--   수정: (1) 엔진 inner loop 에 '활성 정산(suggested/confirmed) 있는 송장 제외' 조건 추가
--         (2) 기존 과정산 송장의 중복 확정 1건을 반려(가장 이른 확정만 유지) → 트리거가 settled_amount 자동 정정.

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
        and ti.issue_date >= v_tx.transaction_date - 186
        -- 이미 활성 정산(제안/확정)이 있는 송장 제외 → 서로 다른 입금이 같은 송장에 중복 매칭되는 것 방지
        and not exists (select 1 from invoice_settlements s2 where s2.tax_invoice_id = ti.id and s2.status <> 'rejected')
      order by ti.issue_date desc
    loop
      v_remaining := coalesce(v_inv.total_amount,0) - coalesce(v_inv.settled_amount,0);
      if v_remaining <= 0 then continue; end if;
      v_gap := v_tx.transaction_date - v_inv.issue_date;
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

-- 기존 데이터 정정: 양수 총액인데 과정산(settled > total)된 송장의 '가장 최근 중복 확정' 1건을 반려.
--   트리거 trg_recalc_settlement 가 settled_amount/통장 정산상태를 자동 재계산(원복).
update invoice_settlements set status = 'rejected'
where id in (
  select distinct on (tax_invoice_id) id
  from invoice_settlements
  where status = 'confirmed'
    and tax_invoice_id in (
      select id from tax_invoices where coalesce(total_amount,0) > 0
        and coalesce(settled_amount,0) > coalesce(total_amount,0) + 1
    )
  order by tax_invoice_id, created_at desc
);
