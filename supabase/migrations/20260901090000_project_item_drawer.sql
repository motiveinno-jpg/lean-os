-- 프로젝트 v3 2단계 — 줄 클릭 서랍 (2026-09-01)
--   기획: docs/20260831_PLAN_projecthub_v3_impl.md 결정 131 (서랍 = 대화 + 체크리스트)
--
--   왜 표 두 개인가: 서랍 안에서 사람이 남기는 것은 성격이 둘이다.
--     ① 시간순으로 쌓이고 지우지 않는 것(댓글 + 상태 바뀜 기록) → project_item_events
--     ② 순서가 있고 켰다 껐다 하는 것(하위 체크리스트)        → project_item_checks
--   하나로 합치면 "체크 해제"가 이력을 오염시키고, 이력에 position 을 다는 이상한 모양이 된다.
--
--   결정 113(한 줄기 시간순): 댓글과 변경 기록을 서로 다른 표에 두면 서랍에서 두 목록을
--   시간순으로 합쳐 보여줘야 한다. 그래서 같은 표에 kind 로만 가른다.
--
--   시드·백필 없음 — 행은 사람이 서랍에서 쓸 때만 생긴다. 회사 데이터를 만드는 자동화가
--   아니므로 feature_rollout 게이트를 새로 두지 않는다(UI 는 이미 projecthub_v3 게이트 안).

-- ─────────────────────────────────────────────────────────────
-- A. project_item_events — 서랍 대화(댓글) + 변경 기록
-- ─────────────────────────────────────────────────────────────
create table if not exists public.project_item_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  item_id uuid not null references public.project_items(id) on delete cascade,
  -- comment = 사람이 쓴 댓글, log = 변경 기록(상태 바뀜 등). 한 줄기 시간순(결정 113)
  kind text not null default 'comment' check (kind in ('comment','log')),
  body text not null,
  meta jsonb not null default '{}'::jsonb,
  -- 저장 컨벤션은 이 저장소 표준대로 public.users(id) — auth.users 를 직접 참조하면
  -- PostgREST 로 쓴 사람 이름을 조인할 수 없다. 형제 표(project_templates 20260831210000)와 동일.
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.project_item_events is
  '프로젝트 v3 서랍 — 항목별 댓글(comment)과 변경 기록(log)을 한 줄기 시간순으로. 2026-09-01 결정 131.';

-- 서랍은 항상 "이 항목의 이벤트를 시간순으로" 만 읽는다
create index if not exists project_item_events_item_idx
  on public.project_item_events(item_id, created_at);

-- ─────────────────────────────────────────────────────────────
-- B. project_item_checks — 서랍 체크리스트
-- ─────────────────────────────────────────────────────────────
create table if not exists public.project_item_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  item_id uuid not null references public.project_items(id) on delete cascade,
  name text not null,
  done boolean not null default false,
  -- 사람이 끌어 옮기는 순서. 정수면 중간 삽입에 전체 재번호가 필요해 numeric(=사이값 가능).
  position numeric not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.project_item_checks is
  '프로젝트 v3 서랍 — 항목 아래 체크리스트. position 은 사이값을 넣을 수 있게 numeric. 2026-09-01 결정 131.';

create index if not exists project_item_checks_item_idx
  on public.project_item_checks(item_id, position);

-- ─────────────────────────────────────────────────────────────
-- C. RLS — project_templates(20260831210000) 와 같은 회사 경계. 4종 명시(빠지면 기본 deny).
--    세무대리인 세션은 읽기 전용(RESTRICTIVE 3종) — 같은 문법.
--    service_role 은 RLS 를 우회하므로 형제 표와 동일하게 별도 정책을 두지 않는다.
-- ─────────────────────────────────────────────────────────────
alter table public.project_item_events enable row level security;

drop policy if exists project_item_events_select on public.project_item_events;
create policy project_item_events_select on public.project_item_events
  for select to authenticated
  using (company_id = (select public.get_my_company_id()));

drop policy if exists project_item_events_insert on public.project_item_events;
create policy project_item_events_insert on public.project_item_events
  for insert to authenticated
  with check (company_id = (select public.get_my_company_id()));

drop policy if exists project_item_events_update on public.project_item_events;
create policy project_item_events_update on public.project_item_events
  for update to authenticated
  using (company_id = (select public.get_my_company_id()))
  with check (company_id = (select public.get_my_company_id()));

drop policy if exists project_item_events_delete on public.project_item_events;
create policy project_item_events_delete on public.project_item_events
  for delete to authenticated
  using (company_id = (select public.get_my_company_id()));

drop policy if exists advisor_ro_ins on public.project_item_events;
create policy advisor_ro_ins on public.project_item_events as restrictive for insert to authenticated
  with check (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_upd on public.project_item_events;
create policy advisor_ro_upd on public.project_item_events as restrictive for update to authenticated
  using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_del on public.project_item_events;
create policy advisor_ro_del on public.project_item_events as restrictive for delete to authenticated
  using (not (select public.is_advisor_session()));

alter table public.project_item_checks enable row level security;

drop policy if exists project_item_checks_select on public.project_item_checks;
create policy project_item_checks_select on public.project_item_checks
  for select to authenticated
  using (company_id = (select public.get_my_company_id()));

drop policy if exists project_item_checks_insert on public.project_item_checks;
create policy project_item_checks_insert on public.project_item_checks
  for insert to authenticated
  with check (company_id = (select public.get_my_company_id()));

drop policy if exists project_item_checks_update on public.project_item_checks;
create policy project_item_checks_update on public.project_item_checks
  for update to authenticated
  using (company_id = (select public.get_my_company_id()))
  with check (company_id = (select public.get_my_company_id()));

drop policy if exists project_item_checks_delete on public.project_item_checks;
create policy project_item_checks_delete on public.project_item_checks
  for delete to authenticated
  using (company_id = (select public.get_my_company_id()));

drop policy if exists advisor_ro_ins on public.project_item_checks;
create policy advisor_ro_ins on public.project_item_checks as restrictive for insert to authenticated
  with check (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_upd on public.project_item_checks;
create policy advisor_ro_upd on public.project_item_checks as restrictive for update to authenticated
  using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_del on public.project_item_checks;
create policy advisor_ro_del on public.project_item_checks as restrictive for delete to authenticated
  using (not (select public.is_advisor_session()));

-- 시드 없음 — 서랍의 댓글·체크는 사람이 화면에서 만든다.
