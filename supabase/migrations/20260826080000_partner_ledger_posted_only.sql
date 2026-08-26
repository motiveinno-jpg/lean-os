-- 거래처 원장: 전표처리(journal_entry_id 보유)된 세금계산서만 집계 (2026-08-26 사장님 지시).
--   "거래처원장에 데이터들 싹다 밀고 전표처리 한 것들만 들어와지게" — 원장은 tax_invoices 파생
--   집계라 행 삭제 없이 조건만 추가한다. 전표처리를 하면 그 건이 다시 원장에 들어온다(가역).
--   클라이언트 3개 조회(원장 시트·거래처 상세·에이징)도 같은 조건으로 맞춘다(같은 커밋).
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
    and ti.journal_entry_id is not null -- 전표처리된 건만 (2026-08-26 사장님 지시)
  group by ti.partner_id, ti.type
$function$;
