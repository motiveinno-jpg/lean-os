-- 목표형 KPI 실적 출처 4종 확장 (2026-06-26, 주간보고 양식 분석 §12-B/C 반영)
--   기존 manual/revenue_auto + profit_auto(매출-태깅원가=마진) + count_auto(태깅 산출물 건수).
--   신규 테이블 0 — source CHECK 확장 + 자동실적 통합 뷰 v_deal_kpi_auto(revenue/profit/output) 신설.
--   기존 v_deal_revenue_actual 은 유지(호환). 신규 코드는 v_deal_kpi_auto 로 일원화.

-- 1) source CHECK 확장 (profit_auto, count_auto 추가)
alter table public.project_kpis drop constraint if exists project_kpis_source_check;
alter table public.project_kpis add constraint project_kpis_source_check
  check (source in ('manual','revenue_auto','profit_auto','count_auto'));

-- 2) 자동 실적 통합 뷰 — deal 당 매출/이익/산출물건수
--    revenue_actual = 태깅 매출(tax_invoices sales, void 제외) supply_amount 합 (출처 1개 고정)
--    profit_actual  = revenue_actual - v_deal_pnl.direct_cost (태깅 원가)
--    output_count   = 태깅 문서(documents.deal_id) 건수
--    security_invoker: 호출자 RLS 적용(회사 격리) — 정의자 권한 우회 방지.
create or replace view public.v_deal_kpi_auto
with (security_invoker = on) as
  select d.id as deal_id,
         coalesce(rev.amount, 0)                                   as revenue_actual,
         coalesce(rev.amount, 0) - coalesce(p.direct_cost, 0)      as profit_actual,
         coalesce(doc.cnt, 0)                                      as output_count
  from public.deals d
  left join (
    select deal_id, sum(supply_amount) as amount
    from public.tax_invoices
    where type = 'sales' and coalesce(status, '') <> 'void' and deal_id is not null
    group by deal_id
  ) rev on rev.deal_id = d.id
  left join public.v_deal_pnl p on p.deal_id = d.id
  left join (
    select deal_id, count(*) as cnt
    from public.documents
    where deal_id is not null
    group by deal_id
  ) doc on doc.deal_id = d.id;
