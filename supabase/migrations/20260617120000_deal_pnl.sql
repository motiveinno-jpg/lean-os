-- 프로젝트(deal) 손익·원가율 인프라 (2026-06-17 핸드오프 v2 Phase 5)
--   additive·비파괴. 기존 전표 백필 금지(신규 입력분부터 deal_id 채워짐).
--   1) journal_entries.deal_id — 전표를 프로젝트 직접원가로 귀속.
--   2) deal_cost_adjustments — 전표 외 수동 원가 가감(택1 (A)).
--   3) v_deal_pnl — deal별 매출/직접원가/원가율/마진 (security_invoker, 판관비 배분은 앱에서).

-- 1) 전표 ↔ 프로젝트 태그
alter table public.journal_entries
  add column if not exists deal_id uuid references public.deals(id) on delete set null;
create index if not exists idx_journal_entries_deal on public.journal_entries(deal_id) where deal_id is not null;

-- 2) 수동 원가 보정 (양수=가산, 음수=차감)
create table if not exists public.deal_cost_adjustments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  amount numeric not null,
  memo text,
  occurred_on date not null default current_date,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_deal_cost_adjustments_deal on public.deal_cost_adjustments(deal_id);

alter table public.deal_cost_adjustments enable row level security;

drop policy if exists deal_cost_adjustments_rw on public.deal_cost_adjustments;
create policy deal_cost_adjustments_rw on public.deal_cost_adjustments
  for all
  using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());

-- 3) deal별 손익 뷰 — 매출(contract_total)·직접원가(전표 expense Σdebit + 보정)·원가율·마진
--    판관비 배분은 기간/모집단이 UI 필터라 앱에서 매출비례로 산출.
drop view if exists public.v_deal_pnl;
create view public.v_deal_pnl
with (security_invoker = true)
as
select
  d.id          as deal_id,
  d.company_id  as company_id,
  coalesce(d.contract_total, 0)                          as revenue,
  coalesce(je_cost.c, 0)                                 as voucher_cost,
  coalesce(adj.c, 0)                                     as adjustment_cost,
  coalesce(je_cost.c, 0) + coalesce(adj.c, 0)            as direct_cost,
  coalesce(d.contract_total, 0) - (coalesce(je_cost.c, 0) + coalesce(adj.c, 0)) as margin,
  case when coalesce(d.contract_total, 0) > 0
       then round((coalesce(je_cost.c, 0) + coalesce(adj.c, 0)) / d.contract_total, 4)
       else null end                                     as direct_cost_ratio
from public.deals d
left join (
  select je.deal_id, sum(jl.debit) as c
  from public.journal_entries je
  join public.journal_lines jl on jl.entry_id = je.id
  join public.chart_of_accounts ca on ca.id = jl.account_id
  where je.deal_id is not null
    and je.status = 'confirmed'
    and ca.account_type = 'expense'
  group by je.deal_id
) je_cost on je_cost.deal_id = d.id
left join (
  select deal_id, sum(amount) as c
  from public.deal_cost_adjustments
  group by deal_id
) adj on adj.deal_id = d.id
where d.archived_at is null;

grant select on public.v_deal_pnl to authenticated;
