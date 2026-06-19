-- 프로젝트 모듈: 세부 프로젝트(sub_deals) 계층 + 세부별 문서·전표 귀속 + 마진 롤업 뷰
-- 핸드오프 2026-06-19 (v2 위 계층 추가). 전부 additive·비파괴. RLS 변경 없음(parent_deal 경유 기존 정책 재사용).
-- 검증: sub_deals 0건 / journal_lines(entry_id,account_id,debit) / chart_of_accounts(id,account_type) / deals.archived_at / v_deal_pnl(deal_id,direct_cost) 일치 확인.

-- 4-1. sub_deals 타입 확정 (sales=매출형 / purchase=매입형). NULL 은 통과(기존 0건이라 무영향, 앱이 입력 강제).
alter table public.sub_deals
  drop constraint if exists sub_deals_type_chk;
alter table public.sub_deals
  add constraint sub_deals_type_chk check (type is null or type in ('sales','purchase'));

-- 4-2. 문서 세부 연결 (nullable, on delete set null — 세부 삭제 시 문서는 deal 에 남고 링크만 해제)
alter table public.documents       add column if not exists sub_deal_id uuid references public.sub_deals(id) on delete set null;
alter table public.quote_approvals add column if not exists sub_deal_id uuid references public.sub_deals(id) on delete set null;
create index if not exists idx_documents_sub_deal       on public.documents(sub_deal_id);
create index if not exists idx_quote_approvals_sub_deal  on public.quote_approvals(sub_deal_id);

-- 4-3. 전표 세부 귀속 (선택 분해축). deal_id=프로젝트(필수) 병행, sub_deal_id=세부(선택). 백필 금지·신규분부터.
alter table public.journal_entries add column if not exists sub_deal_id uuid references public.sub_deals(id) on delete set null;
create index if not exists idx_journal_entries_sub_deal on public.journal_entries(sub_deal_id);

-- 4-4. 세부 프로젝트별 계획/실적 손익 (security_invoker → 호출자 RLS 적용)
drop view if exists public.v_sub_deal_pnl;
create view public.v_sub_deal_pnl with (security_invoker=true) as
select
  s.id                            as sub_deal_id,
  s.parent_deal_id                as deal_id,
  s.name,
  s.type,
  s.partner_id,
  coalesce(s.contract_amount,0)   as planned_amount,
  case when s.type='sales'    then coalesce(s.contract_amount,0) else 0 end as planned_revenue,
  case when s.type='purchase' then coalesce(s.contract_amount,0) else 0 end as planned_cost,
  coalesce(je.c,0)                as actual_cost   -- 4-3 적용 시에만 채워짐(신규 입력분)
from public.sub_deals s
left join (
  select je.sub_deal_id, sum(jl.debit) c
  from public.journal_entries je
  join public.journal_lines jl on jl.entry_id = je.id
  join public.chart_of_accounts ca on ca.id = jl.account_id
  where je.sub_deal_id is not null and je.status='confirmed' and ca.account_type='expense'
  group by je.sub_deal_id
) je on je.sub_deal_id = s.id;

-- 4-5. 프로젝트 최종 마진 롤업 — 계획 마진(사용자 모델) vs 실적 마진(전표). 합산 금지.
drop view if exists public.v_project_margin;
create view public.v_project_margin with (security_invoker=true) as
select
  d.id                                                 as deal_id,
  d.company_id,
  d.name,
  coalesce(d.contract_total,0)                         as main_revenue,
  coalesce(sub.sales_planned,0)                        as sub_sales_planned,
  coalesce(sub.purchase_planned,0)                     as sub_purchase_planned,
  -- 계획 마진 = (총계약금액 + Σ매출형세부) − Σ매입형세부
  (coalesce(d.contract_total,0) + coalesce(sub.sales_planned,0))
      - coalesce(sub.purchase_planned,0)               as planned_margin,
  -- 실적 직접원가(전표+보정): 기존 v_deal_pnl 재사용 — 계획과 합산하지 말 것
  coalesce(p.direct_cost,0)                            as actual_direct_cost,
  (coalesce(d.contract_total,0) - coalesce(p.direct_cost,0)) as actual_margin
from public.deals d
left join (
  select parent_deal_id,
         sum(case when type='sales'    then coalesce(contract_amount,0) else 0 end) sales_planned,
         sum(case when type='purchase' then coalesce(contract_amount,0) else 0 end) purchase_planned
  from public.sub_deals group by parent_deal_id
) sub on sub.parent_deal_id = d.id
left join public.v_deal_pnl p on p.deal_id = d.id
where d.archived_at is null;
