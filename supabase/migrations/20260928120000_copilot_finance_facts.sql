-- AI 참모가 말하는 돈 숫자(미수·미지급·현금·월 손익)를 재무제표 화면과 같은 기준 한 벌로 계산한다.
--   종전엔 스냅샷·list_receivables·get_tax_invoices·get_month_summary 가 제각각 계산해 같은 회사 미수금이
--   22.7억·8.7억·1.9억으로 오갔다. 세금계산서 settled_amount 는 입금 정산을 해야만 채워지는데 대부분 회사가
--   정산을 안 해 "발행 누계"가 미수로 잡혔고, 음수(수정·환입) 계산서를 0 으로 잘라 더 부풀었다.
--   기준:
--     · 미수(외상매출금 108)·미지급(외상매입금 251)·미수금 120·미지급금 253 = 확정 전표 계정 잔액 (/reports/bs 와 같음)
--     · 현금 = bank_accounts.balance 합 + cash_snapshot 보정 (경영요약·아침 브리핑과 같음)
--     · 월 손익 = 확정 전표, 계정 성격·코드로 구간 (account-nature.ts sectionByCode 와 같음)
--   + 숫자를 믿어도 되는지 알려 주는 재료: 전표 안 친 계산서·카드·통장 건수.
begin;

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

  -- 채권·채무 계정 잔액 + 거래처별 상위
  select jsonb_build_object(
    'basis', '확정 전표 외상매출금(108) 잔액 — 재무상태표와 같은 기준, 전체 기간 누계',
    'balance', coalesce((select sum(debit - credit) from _cff_lines where code = '108' and entry_date <= v_today), 0),
    'other_receivable_120', coalesce((select sum(debit - credit) from _cff_lines where code = '120' and entry_date <= v_today), 0),
    'top_partners', coalesce((
      select jsonb_agg(x order by x.amount desc) from (
        select coalesce(p.name, '(거래처 미지정)') as name, sum(l.debit - l.credit) as amount
          from _cff_lines l left join partners p on p.id = l.partner_id
         where l.code = '108' and l.entry_date <= v_today
         group by 1 having sum(l.debit - l.credit) > 1
         order by 2 desc limit 15) x), '[]'::jsonb),
    'unposted_sales_invoices', (
      select jsonb_build_object('count', count(*), 'amount', coalesce(sum(total_amount), 0))
        from tax_invoices where company_id = p_company_id and type = 'sales'
         and status not in ('void', 'draft', 'cancelled') and journal_entry_id is null)
  ) into v_ar;

  select jsonb_build_object(
    'basis', '확정 전표 외상매입금(251) 잔액 — 재무상태표와 같은 기준, 전체 기간 누계',
    'balance', coalesce((select sum(credit - debit) from _cff_lines where code = '251' and entry_date <= v_today), 0),
    'other_payable_253', coalesce((select sum(credit - debit) from _cff_lines where code = '253' and entry_date <= v_today), 0),
    'top_partners', coalesce((
      select jsonb_agg(x order by x.amount desc) from (
        select coalesce(p.name, '(거래처 미지정)') as name, sum(l.credit - l.debit) as amount
          from _cff_lines l left join partners p on p.id = l.partner_id
         where l.code = '251' and l.entry_date <= v_today
         group by 1 having sum(l.credit - l.debit) > 1
         order by 2 desc limit 15) x), '[]'::jsonb),
    'unposted_purchase_invoices', (
      select jsonb_build_object('count', count(*), 'amount', coalesce(sum(total_amount), 0))
        from tax_invoices where company_id = p_company_id and type = 'purchase'
         and status not in ('void', 'draft', 'cancelled') and journal_entry_id is null)
  ) into v_ap;

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

-- 회사 id 를 인자로 받으므로 서버(service_role) 전용 — 로그인 사용자가 남의 회사를 넣어 부르지 못하게.
revoke all on function public.copilot_finance_facts(uuid, text) from public, anon, authenticated;
grant execute on function public.copilot_finance_facts(uuid, text) to service_role;

commit;
