-- 데일리 보고서 일별 스냅샷 (2026-09-04, docs/20260903_PLAN_dashboard_v3_report.md 결정 168)
--   왜: G안 후속 두 가지 — ① "어제 보고서 보기"(날짜 이동)는 그날 숫자가 남아 있어야 하고
--       ② KPI 잔액 30일 추세는 잔액 이력 표가 없어 오늘 잔액에서 역산하고 있었다.
--   한 표로 둘 다: 보고서를 연 날 하루 한 번(30분 간격 상한) 화면이 읽은 숫자를 payload 로 저장한다.
--   저장은 feature_rollout('dashboard_g') 켜진 회사(모티브 먼저)만 — 회사 데이터를 만드는 자동화 규칙(CLAUDE.md).
--   ⚠ users FK 없음 — 회사·본인 단위 표에 users FK 를 걸면 PostgREST 가 junction 으로 오해해 로그인이 깨진다(2026-09-03 장애).
create table if not exists public.daily_report_snapshots (
  company_id uuid not null references public.companies(id) on delete cascade,
  day date not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, day)
);

alter table public.daily_report_snapshots enable row level security;

drop policy if exists drs_select on public.daily_report_snapshots;
create policy drs_select on public.daily_report_snapshots
  for select to authenticated
  using (company_id = (select public.get_my_company_id()));

drop policy if exists drs_insert on public.daily_report_snapshots;
create policy drs_insert on public.daily_report_snapshots
  for insert to authenticated
  with check (company_id = (select public.get_my_company_id()));

drop policy if exists drs_update on public.daily_report_snapshots;
create policy drs_update on public.daily_report_snapshots
  for update to authenticated
  using (company_id = (select public.get_my_company_id()))
  with check (company_id = (select public.get_my_company_id()));

grant select, insert, update on public.daily_report_snapshots to authenticated;
