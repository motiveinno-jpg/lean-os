-- 자동 정산 거래처 해소 보강.
--   통장 입금자명은 계산서 거래처명과 모양이 다르다: "김혜진（만들다）"(대표자+괄호 상호), "（주）대우미곡종합처"(은행 글자수 잘림),
--   "１９８６피트니"(전각 숫자). 종전 규칙(정규화 후 완전 일치)으로는 모티브 입금 2,437건 중 1,130건이 거래처를 못 찾았다.
--   추가 규칙: ① 괄호 안/앞 텍스트를 각각 시도 ② 전각 영숫자 → 반각 ③ 앞부분 일치(4글자 이상, 후보가 딱 하나일 때)
--   금액만으로 맞추는 규칙은 두지 않는다 — 건강보험공단 입금이 광고 거래처 계산서에 붙는 식의 오매칭이 실제로 나왔다.
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

create or replace function public.auto_settle_bank_tx(p_tx uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tx record; v_pid uuid; v_inv record;
  v_n int; v_ndistinct int; v_gap int; v_invtype text; v_reason text;
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

  v_invtype := case when v_tx.type = 'income' then 'sales' else 'purchase' end;
  v_pid := coalesce(v_tx.partner_id, public.resolve_bank_tx_partner(v_tx.company_id, v_tx.counterparty));

  if v_pid is not null then
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
    v_reason := '자동 정산 · 거래처·금액 일치';
  else
    return false;   -- 입금자명으로 거래처를 못 찾으면 자동 정산하지 않는다(금액만으로 맞추면 남의 입금이 붙는다)
  end if;

  if v_pid is not null and v_tx.partner_id is null then
    update bank_transactions set partner_id = v_pid where id = p_tx and partner_id is null;
  end if;

  v_gap := v_tx.transaction_date - v_inv.issue_date;
  insert into invoice_settlements(company_id, bank_transaction_id, tax_invoice_id, amount, match_type, match_source, status, confidence, reason)
  values (v_tx.company_id, p_tx, v_inv.id, least(v_tx.amount, v_inv.remaining), 'one_to_one', 'auto', 'confirmed',
          0.95, format('%s · %s일 경과', v_reason, v_gap))
  on conflict (bank_transaction_id, tax_invoice_id) do update
    set status = 'confirmed', match_source = 'auto', amount = excluded.amount, reason = excluded.reason, updated_at = now()
    where invoice_settlements.status in ('suggested','needs_review');
  return true;
exception when others then
  raise warning 'auto_settle_bank_tx(%) skipped: %', p_tx, sqlerrm;
  return false;
end
$function$;

revoke all on function public.party_name_variants(text) from public;
revoke all on function public.resolve_bank_tx_partner(uuid, text) from public;
revoke all on function public.auto_settle_bank_tx(uuid) from public;
