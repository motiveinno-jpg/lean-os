-- 프로젝트 v3 — 설문 발송(외부 응답 수집) (2026-09-01)
--   기획: docs/20260831_PLAN_projecthub_v3_impl.md (v3 표 UI)
--
--   왜 이 표가 필요한가: v3 표는 회사 안 사람이 채우는 표다. 그런데 실제로 값을 아는 사람은
--   바깥에 있는 경우가 많다(참가 신청, 협력사 정보 회신, 행사 사전조사). 지금은 담당자가
--   카톡·메일로 받아 표에 옮겨 적는다. 그 옮겨적기를 없애려고, 표의 컬럼 일부를 골라
--   외부 링크(/survey/{token}) 로 물어보고 응답을 그대로 project_items 행으로 떨어뜨린다.
--
--   담는 것은 '설문의 설계'뿐 — 응답 값은 project_items 에 쌓인다(이 표에는 건수만 센다).
--   즉 이 표는 발송 설정이고, 응답 본체는 기존 v3 표를 그대로 쓴다.
--
--   게이트: 사람이 화면에서 설문을 만들고 enabled 를 켜야 링크가 산다(자동 생성·크론·시드 없음).
--   회사 데이터를 만드는 자동화가 아니므로 feature_rollout 게이트를 추가하지 않는다 —
--   UI 자체가 이미 projecthub_v3 게이트(20260831180000) 안에 있어 모티브에만 보인다.

-- ─────────────────────────────────────────────────────────────
-- A. project_surveys — 프로젝트별 설문 발송 설정
-- ─────────────────────────────────────────────────────────────
create table if not exists public.project_surveys (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  -- 외부 링크 토큰 — /survey/{token}. 끄면(enabled=false) 즉시 무효.
  --   base64url 을 encode() 로 바로 뽑는 건 PostgreSQL 18+ 이고 이 프로젝트는 17.6 이라
  --   base64 를 뽑고 URL 에 못 쓰는 글자만 바꾼다(+ → -, / → _, = 는 버림).
  --   24바이트 = base64 32글자라 encode() 가 줄바꿈을 넣는 76글자 경계에 닿지 않는다.
  --   pgcrypto 는 이 프로젝트에서 extensions 스키마에 깔려 있어 스키마를 붙여 적는다.
  token text not null unique
    default translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_'),
  enabled boolean not null default false,
  title text not null default '',
  intro text not null default '',           -- 장문 안내문(문단 유지)
  name_label text not null default '성함',   -- 이름 칸을 뭐라고 물을지
  banner_path text,                          -- project-files 버킷 경로(맨 위 배너)
  image_paths jsonb not null default '[]'::jsonb,  -- 안내문 아래 이미지 경로 배열
  -- questions: [{ key, required }] — key 는 project_item_columns.key. 이름 칸은 암묵 필수
  questions jsonb not null default '[]'::jsonb,
  target_stage text not null default '',     -- 응답이 들어갈 그룹(deals.item_stages 의 id)
  response_count int not null default 0,
  -- 저장 컨벤션은 이 저장소 표준대로 public.users(id) — auth.users 를 직접 참조하면
  -- PostgREST 로 만든 사람 이름을 조인할 수 없다. 형제 표(project_templates 20260831210000)와 동일.
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.project_surveys is
  '프로젝트 v3 설문 발송 — 외부 링크(/survey/{token}) 설계만 담는다. 응답 값은 project_items 에 쌓인다. 2026-09-01.';
comment on column public.project_surveys.token is
  '외부 링크 토큰. 이 값이 곧 접근 권한이라 anon 에게 이 표를 열어주지 않는다 — 외부 조회·제출은 엣지 함수(service role)가 담당한다.';

-- 1차 범위: 프로젝트당 설문 1개
create unique index if not exists project_surveys_deal_idx on public.project_surveys (deal_id);
create index if not exists project_surveys_company_idx on public.project_surveys (company_id);

drop trigger if exists project_surveys_set_updated_at on public.project_surveys;
create trigger project_surveys_set_updated_at
  before update on public.project_surveys
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- B. RLS — project_templates(20260831210000) 와 같은 회사 경계. 4종 명시(빠지면 기본 deny).
--    세무대리인 세션은 읽기 전용(RESTRICTIVE 3종) — 같은 문법.
--
--    ⚠ anon 정책은 일부러 두지 않는다. anon 이 이 표를 읽으면 남의 회사 token 까지 긁을 수 있고
--    token 은 그 자체가 열쇠다. 외부 조회·제출은 엣지 함수(service role)가 token 으로 한 행만
--    찾아 돌려준다. service_role 은 RLS 를 우회하므로 형제 표와 동일하게 별도 정책을 두지 않는다.
-- ─────────────────────────────────────────────────────────────
alter table public.project_surveys enable row level security;

drop policy if exists project_surveys_select on public.project_surveys;
create policy project_surveys_select on public.project_surveys
  for select to authenticated
  using (company_id = (select public.get_my_company_id()));

drop policy if exists project_surveys_insert on public.project_surveys;
create policy project_surveys_insert on public.project_surveys
  for insert to authenticated
  with check (company_id = (select public.get_my_company_id()));

drop policy if exists project_surveys_update on public.project_surveys;
create policy project_surveys_update on public.project_surveys
  for update to authenticated
  using (company_id = (select public.get_my_company_id()))
  with check (company_id = (select public.get_my_company_id()));

drop policy if exists project_surveys_delete on public.project_surveys;
create policy project_surveys_delete on public.project_surveys
  for delete to authenticated
  using (company_id = (select public.get_my_company_id()));

drop policy if exists advisor_ro_ins on public.project_surveys;
create policy advisor_ro_ins on public.project_surveys as restrictive for insert to authenticated
  with check (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_upd on public.project_surveys;
create policy advisor_ro_upd on public.project_surveys as restrictive for update to authenticated
  using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_del on public.project_surveys;
create policy advisor_ro_del on public.project_surveys as restrictive for delete to authenticated
  using (not (select public.is_advisor_session()));

-- 시드 없음 — 설문은 사람이 화면에서 만든다.
