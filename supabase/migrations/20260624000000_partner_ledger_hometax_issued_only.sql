-- 거래처 원장 좌측 목록/요약 집계(get_partner_ledger_by_year)에서
-- 실제 홈택스 발행분만 포함 — 미발행 수동/테스트 송장(nts_confirm_no NULL) + void 제외.
-- 우측 원장 시트(PartnerLedgerSheet)와 동일 기준으로 금액 일치시킴.
CREATE OR REPLACE FUNCTION public.get_partner_ledger_by_year(p_year integer)
 RETURNS TABLE(partner_id uuid, type text, prior_outstanding numeric, period_billed numeric, period_settled numeric, period_outstanding numeric, invoice_count integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    and ti.nts_confirm_no is not null   -- 실제 홈택스 발행분만(국세청 승인번호 보유)
    and ti.status <> 'void'             -- 무효 제외
  group by ti.partner_id, ti.type
$function$
