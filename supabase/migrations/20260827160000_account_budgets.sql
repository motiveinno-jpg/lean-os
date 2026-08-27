-- 계정별 월 예산 (2026-08-27 ERP 2순위 '예산 관리') — 재무 › 전표 현황 › 계정과목 탭에서 실적 대비
--   결정 70 — 예산 단위는 '계정과목 × 월'. 부서별은 전표에 부서 칸이 없어 지금은 못 한다(전표에 부서가 생기면 그때).
--   결정 71 — 실적 = 확정 전표의 그 계정 금액(수익은 대변, 비용은 차변). 예산 대비는 조회 기간 안 달들의 합.
create table if not exists public.account_budgets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  account_id uuid not null references public.chart_of_accounts(id) on delete cascade,
  month text not null,
  amount numeric not null default 0,
  memo text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (company_id, account_id, month)
);
create index if not exists account_budgets_company_month_idx on public.account_budgets(company_id, month);
alter table public.account_budgets enable row level security;
drop policy if exists company_isolation on public.account_budgets;
create policy company_isolation on public.account_budgets for all using (company_id = (select public.get_my_company_id()));
drop policy if exists advisor_ro_ins on public.account_budgets;
create policy advisor_ro_ins on public.account_budgets for insert to authenticated with check (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_upd on public.account_budgets;
create policy advisor_ro_upd on public.account_budgets for update to authenticated using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_del on public.account_budgets;
create policy advisor_ro_del on public.account_budgets for delete to authenticated using (not (select public.is_advisor_session()));
