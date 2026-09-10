-- 거래처 원장 좌측 목록을 기간(from~to)으로 집계한다.
--   연 단위 RPC 만 있어 3~6월처럼 기간을 잡으면 목록은 연간 계산서 잔액, 시트는 기간 잔액이 되어 서로 달랐다.
--   포함 기준은 한 줄: 무효·초안이 아니고 전표처리된 계산서. (승인번호 조건을 빼 수기 등록 매입 계산서도 잔액에 잡힌다 —
--   전표까지 친 계산서가 승인번호가 없다는 이유로 원장에서 빠지던 것.)
begin;
create or replace function public.get_partner_ledger_by_period(p_from date, p_to date)
returns table(partner_id uuid, type text, prior_outstanding numeric, period_billed numeric, period_settled numeric, period_outstanding numeric, invoice_count integer)
language sql security definer set search_path to 'public' as $$
  with c as (select public.get_my_company_id() as cid)
  select
    ti.partner_id, ti.type,
    coalesce(sum(case when ti.issue_date < p_from then coalesce(ti.total_amount,0) - coalesce(ti.settled_amount,0) else 0 end), 0) as prior_outstanding,
    coalesce(sum(case when ti.issue_date between p_from and p_to then coalesce(ti.total_amount,0) else 0 end), 0) as period_billed,
    coalesce(sum(case when ti.issue_date between p_from and p_to then coalesce(ti.settled_amount,0) else 0 end), 0) as period_settled,
    coalesce(sum(case when ti.issue_date between p_from and p_to then coalesce(ti.total_amount,0) - coalesce(ti.settled_amount,0) else 0 end), 0) as period_outstanding,
    count(*) filter (where ti.issue_date between p_from and p_to)::int as invoice_count
  from tax_invoices ti
  where ti.company_id = (select cid from c)
    and ti.issue_date <= p_to
    and ti.status not in ('void', 'draft')
    and ti.journal_entry_id is not null
  group by ti.partner_id, ti.type
$$;
revoke all on function public.get_partner_ledger_by_period(date, date) from public, anon;
grant execute on function public.get_partner_ledger_by_period(date, date) to authenticated, service_role;

create or replace function public.get_partner_ledger_by_year(p_year integer)
returns table(partner_id uuid, type text, prior_outstanding numeric, period_billed numeric, period_settled numeric, period_outstanding numeric, invoice_count integer)
language sql security definer set search_path to 'public' as $$
  select * from public.get_partner_ledger_by_period(make_date(p_year, 1, 1), make_date(p_year, 12, 31))
$$;
commit;
