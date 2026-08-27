-- ERP 공백 ③ 월마감 스냅샷 (2026-08-27) — 잠근 달의 재무상태표·손익계산서를 그대로 보관. docs/20260827_PLAN_erp_gaps.md ③
--   결정 57 — 회계마감 '잠금' 순간의 재무제표(계정별 잔액·손익, 합계)를 저장한다. 계산은 화면과 같은 lib(journal-reports)로 — 숫자가 서로 다르면 안 된다.
--   결정 58 — 잠긴 뒤 전표가 바뀌면(반려·정정) 재무제표 화면이 '마감 확정본과 다르다'고 알린다. 스냅샷은 덮어쓰지 않는다(잠금 풀고 다시 잠글 때만 갱신).
create table if not exists public.closing_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  month text not null,
  checklist_id uuid references public.closing_checklists(id) on delete set null,
  taken_at timestamptz not null default now(),
  taken_by uuid,
  bs jsonb not null default '[]'::jsonb,
  pnl jsonb not null default '[]'::jsonb,
  totals jsonb not null default '{}'::jsonb,
  note text,
  unique (company_id, month)
);
alter table public.closing_snapshots enable row level security;
drop policy if exists company_isolation on public.closing_snapshots;
create policy company_isolation on public.closing_snapshots for all using (company_id = (select public.get_my_company_id()));
drop policy if exists advisor_ro_ins on public.closing_snapshots;
create policy advisor_ro_ins on public.closing_snapshots for insert to authenticated with check (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_upd on public.closing_snapshots;
create policy advisor_ro_upd on public.closing_snapshots for update to authenticated using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_del on public.closing_snapshots;
create policy advisor_ro_del on public.closing_snapshots for delete to authenticated using (not (select public.is_advisor_session()));
create index if not exists closing_snapshots_company_month_idx on public.closing_snapshots(company_id, month);
