-- 받을 돈·낼 돈을 한 함수로 — 대시보드 위젯·보고서·경영요약·아침 브리핑·AI 참모가 전부 이것을 읽는다.
--   기준(invoice-arap.ts 에 적힌 결정 그대로): 세금계산서 잔액 = 발행액 − 정산액, 무효·초안·취소 제외, 전표 처리된 것.
--   종전엔 화면마다 따로 셌고, 미수금 위젯·수익 보고서(fetchReceivables)는 마이너스(수정·환입) 계산서를
--   '잔액 1원 이하'로 걸러 버려 원본만 남았다 — 계약을 취소해도 받을 돈이 그대로였다(모티브 16.7억 vs 상계 6.86억).
--   · 거래처 안에서 상계한다(거래처 id, 없으면 계산서 상대방 이름으로 묶음). 순잔액이 1원 넘는 거래처만 돌려준다.
--   · 30일 넘은 몫(over30) = 순잔액 − 최근 30일 발행분. 받은 돈·취소분은 오래된 계산서부터 지운다고 본다(선입선출).
--   · oldest_open_date = 그 규칙으로 아직 덜 받은 가장 오래된 계산서 발행일.
--   security invoker — 화면에서 부르면 tax_invoices·partners 의 RLS 가 그대로 걸린다.
begin;

create or replace function public.receivables_by_partner(p_company_id uuid, p_type text default 'sales')
returns table(partner_key text, partner_id uuid, name text, balance numeric, over30 numeric, oldest_open_date date, invoice_count integer)
language sql stable security invoker set search_path to 'public' as $$
  with inv as (
    select ti.id, ti.partner_id, ti.issue_date,
           coalesce(nullif(trim(ti.counterparty_name), ''), '(미상)') as cp,
           coalesce(ti.partner_id::text, 'n:' || coalesce(nullif(trim(ti.counterparty_name), ''), '(미상)')) as k,
           coalesce(nullif(ti.total_amount, 0), ti.supply_amount, 0) - coalesce(ti.settled_amount, 0) as bal
      from tax_invoices ti
     where ti.company_id = p_company_id and ti.type = p_type
       and ti.status not in ('void', 'draft', 'cancelled')
       and ti.journal_entry_id is not null
  ), agg as (
    select k, (array_agg(partner_id) filter (where partner_id is not null))[1] as pid,
           (array_agg(cp order by issue_date desc nulls last))[1] as cp_name,
           sum(bal) as balance, count(*)::int as n
      from inv group by k
  ), pos as (
    -- 양수 잔액 계산서를 최신부터 쌓은 누계 — 순잔액만큼이 '아직 덜 받은' 최신 계산서들이다
    select k, issue_date, bal,
           sum(bal) over (partition by k order by issue_date desc nulls last, id desc) as run
      from inv where bal > 1
  ), today as (select (now() at time zone 'Asia/Seoul')::date as d)
  select a.k, a.pid, coalesce(p.name, a.cp_name), a.balance,
         greatest(0, a.balance - coalesce((select sum(x.bal) from pos x, today t where x.k = a.k and x.issue_date >= t.d - 30), 0)),
         (select min(x.issue_date) from pos x where x.k = a.k and x.run - x.bal < a.balance),
         a.n
    from agg a left join partners p on p.id = a.pid
   where a.balance > 1
$$;

revoke all on function public.receivables_by_partner(uuid, text) from public, anon;
grant execute on function public.receivables_by_partner(uuid, text) to authenticated, service_role;

create or replace function public.copilot_finance_facts(p_company_id uuid, p_month text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_month text := coalesce(nullif(p_month, ''), to_char(v_today, 'YYYY-MM'));
  v_from date;
  v_to date;
  v_ar jsonb; v_ap jsonb; v_cash jsonb; v_pnl jsonb; v_unposted jsonb;
begin
  if v_month !~ '^\d{4}-\d{2}$' then
    raise exception 'p_month must be YYYY-MM';
  end if;
  v_from := to_date(v_month || '-01', 'YYYY-MM-DD');
  v_to := (v_from + interval '1 month' - interval '1 day')::date;

  -- 확정 전표 줄 + 계정 (오늘까지)
  create temp table if not exists _cff_lines (
    entry_id uuid, entry_date date, code text, name text, nature text,
    debit numeric, credit numeric, partner_id uuid
  ) on commit drop;
  truncate _cff_lines;
  insert into _cff_lines
  select e.id, e.entry_date, a.code, a.name, coalesce(a.account_type, 'expense'),
         coalesce(l.debit, 0), coalesce(l.credit, 0), l.partner_id
    from journal_lines l
    join journal_entries e on e.id = l.entry_id
    join chart_of_accounts a on a.id = l.account_id
   where e.company_id = p_company_id and l.company_id = p_company_id
     and e.status = 'confirmed' and e.entry_date <= greatest(v_today, v_to);

  -- 받을 돈·낼 돈 = 세금계산서 잔액(receivables_by_partner — 대시보드·보고서와 같은 함수) + 참고용 장부 계정 잔액
  select jsonb_build_object(
    'basis', '세금계산서 잔액(발행액 − 입금 정산, 수정·환입 계산서 상계, 전표 처리된 것) — 대시보드 미수금·경영요약과 같은 기준, 전체 기간 누계',
    'balance', coalesce(sum(r.balance), 0),
    'over30', coalesce(sum(r.over30), 0),
    'partner_count', count(*),
    'top_partners', coalesce(jsonb_agg(jsonb_build_object('name', r.name, 'amount', r.balance, 'over30', r.over30, 'oldest_open_date', r.oldest_open_date)
                     order by r.balance desc) filter (where r.rn <= 15), '[]'::jsonb),
    'ledger_account_108', coalesce((select sum(debit - credit) from _cff_lines where code = '108' and entry_date <= v_today), 0),
    'other_receivable_120', coalesce((select sum(debit - credit) from _cff_lines where code = '120' and entry_date <= v_today), 0),
    'settled_invoice_count', (select count(*) from tax_invoices where company_id = p_company_id and type = 'sales' and coalesce(settled_amount, 0) > 0),
    'unposted_sales_invoices', (
      select jsonb_build_object('count', count(*), 'amount', coalesce(sum(total_amount), 0))
        from tax_invoices where company_id = p_company_id and type = 'sales'
         and status not in ('void', 'draft', 'cancelled') and journal_entry_id is null)
  ) into v_ar
  from (select *, row_number() over (order by balance desc) rn from public.receivables_by_partner(p_company_id, 'sales')) r;

  select jsonb_build_object(
    'basis', '매입 세금계산서 잔액(발행액 − 지급 정산, 수정 계산서 상계, 전표 처리된 것) — 경영요약의 낼 돈과 같은 기준, 전체 기간 누계',
    'balance', coalesce(sum(r.balance), 0),
    'over30', coalesce(sum(r.over30), 0),
    'partner_count', count(*),
    'top_partners', coalesce(jsonb_agg(jsonb_build_object('name', r.name, 'amount', r.balance, 'over30', r.over30, 'oldest_open_date', r.oldest_open_date)
                     order by r.balance desc) filter (where r.rn <= 15), '[]'::jsonb),
    'ledger_account_251', coalesce((select sum(credit - debit) from _cff_lines where code = '251' and entry_date <= v_today), 0),
    'other_payable_253', coalesce((select sum(credit - debit) from _cff_lines where code = '253' and entry_date <= v_today), 0),
    'settled_invoice_count', (select count(*) from tax_invoices where company_id = p_company_id and type = 'purchase' and coalesce(settled_amount, 0) > 0),
    'unposted_purchase_invoices', (
      select jsonb_build_object('count', count(*), 'amount', coalesce(sum(total_amount), 0))
        from tax_invoices where company_id = p_company_id and type = 'purchase'
         and status not in ('void', 'draft', 'cancelled') and journal_entry_id is null)
  ) into v_ap
  from (select *, row_number() over (order by balance desc) rn from public.receivables_by_partner(p_company_id, 'purchase')) r;

  select jsonb_build_object(
    'basis', '통장 잔액 합계(마지막 동기화) + 설정의 현금 보정값 — 경영요약·아침 브리핑과 같은 기준',
    'bank_total', coalesce((select sum(balance) from bank_accounts where company_id = p_company_id), 0),
    'manual_adjustment', coalesce((select current_balance from cash_snapshot where company_id = p_company_id), 0),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object('bank', bank_name, 'alias', alias, 'balance', balance) order by is_primary desc nulls last, balance desc nulls last)
        from bank_accounts where company_id = p_company_id), '[]'::jsonb)
  ) into v_cash;
  v_cash := v_cash || jsonb_build_object('total', (v_cash->>'bank_total')::numeric + (v_cash->>'manual_adjustment')::numeric);

  with m as (
    select *,
      case
        when nature not in ('revenue', 'expense') then null
        when coalesce(nullif(regexp_replace(code, '\D', '', 'g'), ''), '') = '' then case when nature = 'revenue' then 'revenue' else 'opex' end
        when nature = 'revenue' then case when regexp_replace(code, '\D', '', 'g')::int >= 900 then 'nonop_income' else 'revenue' end
        when regexp_replace(code, '\D', '', 'g')::int = 998 then 'tax'
        when regexp_replace(code, '\D', '', 'g')::int >= 900 then 'nonop_expense'
        when regexp_replace(code, '\D', '', 'g')::int >= 800 then 'opex'
        else 'cogs'
      end as section,
      case when nature = 'revenue' then credit - debit else debit - credit end as amt
    from _cff_lines where entry_date between v_from and v_to
  ), s as (
    select
      coalesce(sum(amt) filter (where section = 'revenue'), 0) rev,
      coalesce(sum(amt) filter (where section = 'cogs'), 0) cogs,
      coalesce(sum(amt) filter (where section = 'opex'), 0) opex,
      coalesce(sum(amt) filter (where section = 'nonop_income'), 0) ni,
      coalesce(sum(amt) filter (where section = 'nonop_expense'), 0) ne,
      coalesce(sum(amt) filter (where section = 'tax'), 0) tax
    from m
  )
  select jsonb_build_object(
    'month', v_month,
    'basis', '확정 전표 기준 손익(손익계산서 화면과 같음) — 전표 안 친 계산서·카드·통장은 빠져 있음',
    'revenue', rev, 'cogs', cogs, 'opex', opex,
    'operating_profit', rev - cogs - opex,
    'nonop_income', ni, 'nonop_expense', ne, 'income_tax', tax,
    'net_profit', rev - cogs - opex + ni - ne - tax,
    'top_expense_accounts', coalesce((
      select jsonb_agg(x order by x.amount desc) from (
        select name, sum(amt) amount from m where section in ('cogs', 'opex', 'nonop_expense')
         group by name having sum(amt) <> 0 order by 2 desc limit 10) x), '[]'::jsonb)
  ) into v_pnl from s;

  select jsonb_build_object(
    'tax_invoices', (select count(*) from tax_invoices where company_id = p_company_id and status <> 'void'
                       and journal_entry_id is null and issue_date between v_from and v_to),
    'card', (select count(*) from card_transactions where company_id = p_company_id and journal_entry_id is null
               and ledger_excluded_reason is null and transaction_date between v_from and v_to),
    'bank', (select count(*) from bank_transactions where company_id = p_company_id and journal_entry_id is null
               and ledger_excluded_reason is null and settlement_status = 'open' and transaction_date between v_from and v_to)
  ) into v_unposted;
  v_pnl := v_pnl || jsonb_build_object('unposted_in_month', v_unposted);

  return jsonb_build_object('as_of', v_today, 'receivables', v_ar, 'payables', v_ap, 'cash', v_cash, 'month_pnl', v_pnl);
end;
$$;

revoke all on function public.copilot_finance_facts(uuid, text) from public, anon, authenticated;
grant execute on function public.copilot_finance_facts(uuid, text) to service_role;

commit;
