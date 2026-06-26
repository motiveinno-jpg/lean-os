-- 목표형 성과 운영 + 구조화 체크인 (2026-06-26)
--   P2b: 멤버 배정(deal_assignments 재활용) + 주기 체크인(checkin_cadence) + KPI 책임자(owner_id)
--        + 구조화 체크인(3문항 + period_start) + 미제출 리마인더 알림 type.
--   기존 project_updates.body(단일 코멘트)는 유지(과거 행 호환). 신규 행은 did/issues/next_plan 사용.
--   신규 테이블 없음 — 기존 테이블 컬럼 추가 + 부분 UNIQUE + 알림 type 확장만. 무중단.

-- 1) deals: 체크인 주기 설정 (목표형)
alter table public.deals
  add column if not exists checkin_cadence text
    check (checkin_cadence in ('weekly','biweekly','monthly','none')),
  add column if not exists checkin_due_weekday int
    check (checkin_due_weekday between 0 and 6);

-- 2) project_kpis: KPI 책임자
alter table public.project_kpis
  add column if not exists owner_id uuid references public.users(id) on delete set null;

-- 3) project_updates: 구조화 3문항 + 주기 window
alter table public.project_updates
  add column if not exists period_start date,
  add column if not exists did text,
  add column if not exists issues text,
  add column if not exists next_plan text;

-- 멤버별 1주기 1행 (둘 다 not null 일 때만 — 과거 행/관리자 임시 작성은 자유)
create unique index if not exists uq_project_updates_member_period
  on public.project_updates (deal_id, created_by, period_start)
  where created_by is not null and period_start is not null;
create index if not exists idx_project_updates_period
  on public.project_updates (deal_id, period_start desc);
create index if not exists idx_project_updates_author
  on public.project_updates (created_by, period_start);

-- 4) 미제출 리마인더 알림 type 확장 (idempotent — 기존 enum 셋 + project_checkin_due)
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array[
    'deal_update'::text,
    'expense_request'::text,
    'contract_expiry'::text,
    'signature_request'::text,
    'payment_due'::text,
    'system'::text,
    'document'::text,
    'approval'::text,
    'chat'::text,
    'overtime_auto_clockout'::text,
    'project_checkin_due'::text
  ]));
