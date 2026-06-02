-- 거래처 채권·채무 대사 Phase 2 — 규칙 기반 매칭 엔진 (AI 비용 0, suggested 만 출력).
-- 미정산 입금/출금 ↔ 미정산 송장을 거래처 해소 + 금액 규칙으로 매칭해 invoice_settlements 에
-- status='suggested' 로 INSERT. 확정(미수금 차감)은 사용자가 확인 큐에서 confirmed 전환 시에만.

-- 입금자명/거래처명 정규화 — 전각괄호/공백 변환 + 법인격·기호 제거 후 핵심 상호만 비교.
create or replace function public.normalize_party_name(t text)
returns text language sql immutable as $$
  select regexp_replace(
           translate(lower(coalesce(t, '')), '（）　', '() '),
           '(주식회사|유한회사|유한책임회사|합자회사|합명회사|농업회사법인|사회적협동조합|협동조합|㈜|\(주\)|주\)|\(유\)|\(재\)|\(사\)|[[:space:]]|[+().,·\-_/])',
           '', 'g'
         );
$$;

-- 정규화 매칭 가속용 함수 인덱스 (immutable 함수라 가능)
create index if not exists idx_partners_norm_name on public.partners (company_id, public.normalize_party_name(name));
create index if not exists idx_partners_norm_rep on public.partners (company_id, public.normalize_party_name(representative));
create index if not exists idx_partner_aliases_norm on public.partner_aliases (company_id, public.normalize_party_name(alias));

create or replace function public.generate_settlement_suggestions(p_days int default 180)
returns jsonb
language plpgsql
security definer
set search_path = public
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
  v_cutoff date := (current_date - p_days);
begin
  v_company := public.get_my_company_id();
  if v_company is null then raise exception '권한이 없습니다.'; end if;

  for v_tx in
    select bt.id, bt.amount, bt.transaction_date, bt.counterparty, bt.type, bt.partner_id
    from bank_transactions bt
    where bt.company_id = v_company
      and bt.settlement_status = 'open'
      and bt.type in ('income','expense')
      and bt.transaction_date >= v_cutoff
      and coalesce(bt.amount,0) > 0
  loop
    v_norm := public.normalize_party_name(v_tx.counterparty);
    if v_norm = '' then continue; end if;

    -- 1) 거래처 해소: partner_id 기존 → alias → 거래처명 → 대표자명(개인 입금)
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

    if v_pid is null then continue; end if; -- 미해소 → AI/수동 단계로
    v_resolved := v_resolved + 1;
    if v_tx.partner_id is null then
      update bank_transactions set partner_id = v_pid where id = v_tx.id;
    end if;

    -- 2) 금액 매칭 (one_to_one 정확 / withholding 원천징수 3.3%)
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

revoke execute on function public.generate_settlement_suggestions(int) from public, anon;
grant execute on function public.generate_settlement_suggestions(int) to authenticated;
