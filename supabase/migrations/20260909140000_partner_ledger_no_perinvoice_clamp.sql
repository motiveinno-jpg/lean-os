-- 거래처 원장 잔액이 실제와 안 맞던 근본 원인 수정 (2026-09-09 사장님).
--
-- 증상: 좌측 목록 잔액이 우측 일자별 원장(차변/대변/잔액) 시트와 안 맞고, 전반적으로 과대.
-- 원인: get_partner_ledger_by_year 가 세금계산서 한 건마다 greatest(총액-정산, 0) 로 '음수 클램프'를 걸어,
--       마이너스(수정·반품·에누리) 세금계산서를 잔액에서 통째로 지웠다. 우측 시트는 원(raw) 합산이라
--       마이너스를 그대로 차감 → 두 값이 근본적으로 달랐다(모티브: 목록 16.7억 vs 실제 6.86억, 마이너스 계산서 398건).
-- 해결: 건별 클램프 제거 → 거래처별 원(raw) 합산(총액-정산). 마이너스 계산서가 잔액을 정상적으로 줄인다.
--       거래처 단위 음수(선수금 등) 처리는 소비하는 화면 몫(ledger-arap 는 이미 거래처별 max(0,·)).
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
        then coalesce(ti.total_amount,0) - coalesce(ti.settled_amount,0) else 0 end), 0)             as prior_outstanding,
    coalesce(sum(case when ti.issue_date between (select d0 from y) and (select d1 from y)
        then coalesce(ti.total_amount,0) else 0 end), 0)                                             as period_billed,
    coalesce(sum(case when ti.issue_date between (select d0 from y) and (select d1 from y)
        then coalesce(ti.settled_amount,0) else 0 end), 0)                                           as period_settled,
    coalesce(sum(case when ti.issue_date between (select d0 from y) and (select d1 from y)
        then coalesce(ti.total_amount,0) - coalesce(ti.settled_amount,0) else 0 end), 0)             as period_outstanding,
    count(*) filter (where ti.issue_date between (select d0 from y) and (select d1 from y))::int      as invoice_count
  from tax_invoices ti
  where ti.company_id = (select cid from c)
    and ti.issue_date <= (select d1 from y)
    and ti.nts_confirm_no is not null   -- 실제 홈택스 발행분만(국세청 승인번호 보유)
    and ti.status <> 'void'             -- 무효 제외
    and ti.journal_entry_id is not null -- 전표처리된 건만 (2026-08-26 사장님 지시)
  group by ti.partner_id, ti.type
$function$;
