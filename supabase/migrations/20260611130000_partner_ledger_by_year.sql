-- 2026-06-11 거래처 원장 연도별 조회 + 전기이월.
--   p_year 선택 시 거래처·유형별로:
--     prior_outstanding(전기이월) = 선택연도 1/1 이전에 발행된 송장의 현재 미정산 잔액(아직 못 받은/안 준 전년도 분)
--     period_billed/settled/outstanding(당기) = 선택연도 1/1~12/31 발행분
--   회사 격리 = get_my_company_id(). 미래연도 송장은 제외(issue_date <= 연말).
create or replace function public.get_partner_ledger_by_year(p_year int)
returns table(
  partner_id uuid,
  type text,
  prior_outstanding numeric,
  period_billed numeric,
  period_settled numeric,
  period_outstanding numeric,
  invoice_count int
)
language sql security definer set search_path to 'public' as $$
  with c as (select public.get_my_company_id() as cid),
  y as (select make_date(p_year, 1, 1) as d0, make_date(p_year, 12, 31) as d1)
  select
    ti.partner_id,
    ti.type,
    coalesce(sum(case when ti.issue_date < (select d0 from y)
        then greatest(coalesce(ti.total_amount,0) - coalesce(ti.settled_amount,0), 0) else 0 end), 0)             as prior_outstanding,
    coalesce(sum(case when ti.issue_date between (select d0 from y) and (select d1 from y)
        then coalesce(ti.total_amount,0) else 0 end), 0)                                                          as period_billed,
    coalesce(sum(case when ti.issue_date between (select d0 from y) and (select d1 from y)
        then coalesce(ti.settled_amount,0) else 0 end), 0)                                                        as period_settled,
    coalesce(sum(case when ti.issue_date between (select d0 from y) and (select d1 from y)
        then greatest(coalesce(ti.total_amount,0) - coalesce(ti.settled_amount,0), 0) else 0 end), 0)             as period_outstanding,
    count(*) filter (where ti.issue_date between (select d0 from y) and (select d1 from y))::int                  as invoice_count
  from tax_invoices ti
  where ti.company_id = (select cid from c)
    and ti.issue_date <= (select d1 from y)
  group by ti.partner_id, ti.type
$$;

grant execute on function public.get_partner_ledger_by_year(int) to authenticated;
