-- 정산 제안 엔진의 거래처 인식 보강 (제안만 만든다 — 확정은 종전대로 사람이).
--   통장 입금자명은 계산서 거래처명과 모양이 다르다: "김혜진（만들다）"(대표자+괄호 상호), "（주）대우미곡종합처"(은행 글자수 잘림),
--   "１９８６피트니"(전각 숫자). 정규화 후 완전 일치만으로는 모티브 입금 2,437건 중 1,130건이 거래처를 못 찾았고,
--   아래 규칙으로 그중 867건이 풀린다. 금액만으로 맞추는 규칙은 두지 않는다(오매칭).
SET statement_timeout = '120000';

create or replace function public.party_name_variants(t text)
returns text[]
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
  with base as (
    select translate(coalesce(t, ''),
      '０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ（）　',
      '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz() ') as s
  )
  select array_remove(array[
    public.normalize_party_name(s),
    public.normalize_party_name(nullif((regexp_match(s, '\(([^()]{2,})'))[1], '')),   -- 괄호 안 (닫는 괄호가 잘려도)
    public.normalize_party_name(nullif(split_part(s, '(', 1), ''))                     -- 괄호 앞
  ], '') from base
$function$;

create or replace function public.resolve_bank_tx_partner(p_company uuid, p_counterparty text)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v text; v_pid uuid; v_n int;
begin
  foreach v in array coalesce((select array_agg(distinct x) from unnest(public.party_name_variants(p_counterparty)) x), '{}'::text[]) loop
    if v is null or v = '' then continue; end if;
    select pa.partner_id into v_pid from partner_aliases pa
      where pa.company_id = p_company and public.normalize_party_name(pa.alias) = v limit 1;
    if v_pid is not null then return v_pid; end if;
    select p.id into v_pid from partners p
      where p.company_id = p_company and public.normalize_party_name(p.name) = v limit 1;
    if v_pid is not null then return v_pid; end if;
    select p.id into v_pid from partners p
      where p.company_id = p_company and p.representative is not null
        and public.normalize_party_name(p.representative) = v limit 1;
    if v_pid is not null then return v_pid; end if;
  end loop;
  -- 앞부분 일치 — 은행이 이름을 잘랐거나 상호 뒤에 지점명 등이 붙은 경우. 후보가 하나일 때만.
  foreach v in array coalesce((select array_agg(distinct x) from unnest(public.party_name_variants(p_counterparty)) x), '{}'::text[]) loop
    if v is null or length(v) < 4 then continue; end if;
    select count(*), min(p.id::text)::uuid into v_n, v_pid from partners p
      where p.company_id = p_company
        and (public.normalize_party_name(p.name) like v || '%' or v like public.normalize_party_name(p.name) || '%')
        and length(public.normalize_party_name(p.name)) >= 4;
    if v_n = 1 then return v_pid; end if;
  end loop;
  return null;
end
$function$;


CREATE OR REPLACE FUNCTION public.generate_settlement_suggestions(p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
declare
  v_company uuid; v_tx record; v_inv record; v_pid uuid;
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
      and not exists (select 1 from invoice_settlements s where s.bank_transaction_id = bt.id and s.status = 'rejected')
  loop
    -- 거래처 해소: 별칭·거래처명·대표자명 완전 일치 + 괄호 안/앞·전각→반각·앞부분 유일 일치 (resolve_bank_tx_partner)
    v_pid := coalesce(v_tx.partner_id, public.resolve_bank_tx_partner(v_company, v_tx.counterparty));
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
$function$
;

revoke all on function public.party_name_variants(text) from public;
revoke all on function public.resolve_bank_tx_partner(uuid, text) from public;
