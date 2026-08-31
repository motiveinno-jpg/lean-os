-- 프로젝트 v3 — "우리 회사 양식" 저장 (2026-08-31)
--   기획: docs/20260831_PLAN_projecthub_v3_impl.md (v3 표 UI)
--
--   왜 이 표가 필요한가: v3 표에서 회사가 커스텀 컬럼(project_item_columns)과 단계(deals.item_stages)를
--   한 번 잘 짜놓으면, 다음 프로젝트에서 그걸 처음부터 다시 만든다. monday 의 '만든 사람: {회사}'
--   템플릿처럼 "지금 쓰는 표의 구조"를 양식으로 떠서 재사용할 곳이 필요하다.
--
--   담는 것은 구조뿐 — 값(project_items 행·fields)은 담지 않는다. 즉 이 표는 설계도 보관함이고,
--   양식을 적용하면 새 deal 에 컬럼 정의와 단계만 깔린다.
--
--   게이트: 사람이 화면에서 '양식으로 저장' 버튼을 눌러야 행이 생긴다(자동 백필·크론·시드 없음).
--   회사 데이터를 만드는 자동화가 아니므로 feature_rollout 게이트를 추가하지 않는다 —
--   UI 자체가 이미 projecthub_v3 게이트(20260831180000) 안에 있어 모티브에만 보인다.

-- ─────────────────────────────────────────────────────────────
-- A. project_templates — 회사 양식(표 구조) 보관
-- ─────────────────────────────────────────────────────────────
create table if not exists public.project_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  icon text not null default '⭐',
  -- spec = { cols: [{name, type, options?}], stages: [{id, label, color}] }
  --   cols.type 은 project_item_columns.type 과 같은 6종(text/number/date/select/person/partner),
  --   stages 는 deals.item_stages 와 같은 형태. 값이 아니라 구조만 담는다.
  spec jsonb not null default '{}'::jsonb,
  -- 저장 컨벤션은 이 저장소 표준대로 public.users(id) — auth.users 를 직접 참조하면
  -- PostgREST 로 만든 사람 이름을 조인할 수 없다. 형제 표(project_items 20260831140000)와 동일.
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

comment on table public.project_templates is
  '프로젝트 v3 회사 양식 — 표 구조(커스텀 컬럼 정의 + 단계)만 담는다. 값은 담지 않는다. 2026-08-31.';

create index if not exists project_templates_company_idx
  on public.project_templates(company_id) where archived_at is null;

-- ─────────────────────────────────────────────────────────────
-- B. RLS — project_item_columns(20260831180000) 와 같은 회사 경계. 4종 명시(빠지면 기본 deny).
--    세무대리인 세션은 읽기 전용(RESTRICTIVE 3종) — 같은 문법.
--    service_role 은 RLS 를 우회하므로 형제 표와 동일하게 별도 정책을 두지 않는다.
-- ─────────────────────────────────────────────────────────────
alter table public.project_templates enable row level security;

drop policy if exists project_templates_select on public.project_templates;
create policy project_templates_select on public.project_templates
  for select to authenticated
  using (company_id = (select public.get_my_company_id()));

drop policy if exists project_templates_insert on public.project_templates;
create policy project_templates_insert on public.project_templates
  for insert to authenticated
  with check (company_id = (select public.get_my_company_id()));

drop policy if exists project_templates_update on public.project_templates;
create policy project_templates_update on public.project_templates
  for update to authenticated
  using (company_id = (select public.get_my_company_id()))
  with check (company_id = (select public.get_my_company_id()));

drop policy if exists project_templates_delete on public.project_templates;
create policy project_templates_delete on public.project_templates
  for delete to authenticated
  using (company_id = (select public.get_my_company_id()));

drop policy if exists advisor_ro_ins on public.project_templates;
create policy advisor_ro_ins on public.project_templates as restrictive for insert to authenticated
  with check (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_upd on public.project_templates;
create policy advisor_ro_upd on public.project_templates as restrictive for update to authenticated
  using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_del on public.project_templates;
create policy advisor_ro_del on public.project_templates as restrictive for delete to authenticated
  using (not (select public.is_advisor_session()));

-- 시드 없음 — 양식은 사람이 화면에서 저장한다.
