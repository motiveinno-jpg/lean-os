-- A-safe: 매출/매입 관리(sub_deals)는 '입력한 총액' 그대로 저장 + vat_type 플래그.
--   마진 계산은 vat_type 기준 net(공급가액) 역산 → 마진 정확성 유지.
--   deals.contract_total 은 기존대로 net 저장(자동 세금계산서/대시보드/리포트 안전).
--   deals.vat_type 은 플래그만 기록: 기존 행은 net 저장이므로 exclusive 로 백필, 기본값도 exclusive.
-- 프로덕션 적용 완료(2026-06-22) — 버전관리용 박제.

-- 1) sub_deals VAT 플래그 (신규 컬럼, 데이터 0건). 기본 exclusive(=별도, 입력값=공급가액).
alter table public.sub_deals add column if not exists vat_type text not null default 'exclusive';
alter table public.sub_deals drop constraint if exists sub_deals_vat_type_chk;
alter table public.sub_deals add constraint sub_deals_vat_type_chk check (vat_type in ('inclusive','exclusive'));

-- 2) deals: 기존 행 백필 + 기본값 변경 (저장값은 net 그대로, 의미만 명시).
update public.deals set vat_type = 'exclusive' where vat_type is distinct from 'exclusive';
alter table public.deals alter column vat_type set default 'exclusive';

-- 3) 세부별 손익 뷰 — planned_revenue/planned_cost 는 net 역산(마진용). planned_amount 는 입력값(총액) 그대로.
drop view if exists public.v_sub_deal_pnl;
create view public.v_sub_deal_pnl with (security_invoker=true) as
select
  s.id                            as sub_deal_id,
  s.parent_deal_id                as deal_id,
  s.name,
  s.type,
  s.partner_id,
  coalesce(s.contract_amount,0)   as planned_amount,  -- 입력한 총액(표시용)
  case when s.type='sales'    then (case when s.vat_type='inclusive' then round(coalesce(s.contract_amount,0)/1.1) else coalesce(s.contract_amount,0) end) else 0 end as planned_revenue,
  case when s.type='purchase' then (case when s.vat_type='inclusive' then round(coalesce(s.contract_amount,0)/1.1) else coalesce(s.contract_amount,0) end) else 0 end as planned_cost,
  coalesce(je.c,0)                as actual_cost
from public.sub_deals s
left join (
  select je.sub_deal_id, sum(jl.debit) c
  from public.journal_entries je
  join public.journal_lines jl on jl.entry_id = je.id
  join public.chart_of_accounts ca on ca.id = jl.account_id
  where je.sub_deal_id is not null and je.status='confirmed' and ca.account_type='expense'
  group by je.sub_deal_id
) je on je.sub_deal_id = s.id;

-- 4) 프로젝트 마진 롤업 — 세부(sub_deals) 매출/매입을 net 역산해 계획 마진 산출. main_revenue=contract_total(net) 유지.
drop view if exists public.v_project_margin;
create view public.v_project_margin with (security_invoker=true) as
select
  d.id                                                 as deal_id,
  d.company_id,
  d.name,
  coalesce(d.contract_total,0)                         as main_revenue,
  coalesce(sub.sales_planned,0)                        as sub_sales_planned,
  coalesce(sub.purchase_planned,0)                     as sub_purchase_planned,
  (coalesce(d.contract_total,0) + coalesce(sub.sales_planned,0))
      - coalesce(sub.purchase_planned,0)               as planned_margin,
  coalesce(p.direct_cost,0)                            as actual_direct_cost,
  (coalesce(d.contract_total,0) - coalesce(p.direct_cost,0)) as actual_margin
from public.deals d
left join (
  select parent_deal_id,
         sum(case when type='sales'    then (case when vat_type='inclusive' then round(coalesce(contract_amount,0)/1.1) else coalesce(contract_amount,0) end) else 0 end) sales_planned,
         sum(case when type='purchase' then (case when vat_type='inclusive' then round(coalesce(contract_amount,0)/1.1) else coalesce(contract_amount,0) end) else 0 end) purchase_planned
  from public.sub_deals group by parent_deal_id
) sub on sub.parent_deal_id = d.id
left join public.v_deal_pnl p on p.deal_id = d.id
where d.archived_at is null;
