-- 프로젝트 v3 — 상태 보고(주간 보고 기록) (2026-09-02)
--   기획: docs/20260831_PLAN_projecthub_v3_impl.md · 결정 140 · 사장님 승인 목업 5f28666a
--
--   History: 오두(Odoo) '프로젝트 업데이트'에 대응하는 자리다. 지금 v3 표는 '지금 어떤가'는
--   보여주지만 '지난주에 어땠는가'가 남지 않는다. 그래서 주마다 사람이 신호등 하나와 한 줄
--   코멘트를 남기고, 그때의 숫자를 함께 굳혀 두는 표를 만든다. 숫자는 화면이 자동으로 채우고
--   사람이 고르는 것은 신호등·코멘트뿐이다.
--
--   자문자답
--   ① 무엇을 기준으로 행이 생기는가: 사람이 화면에서 '보고 만들기'를 눌러 저장한 행만이다.
--      자동 생성·크론·백필·시드가 없으므로 회사 데이터를 만드는 자동화가 아니고,
--      feature_rollout 게이트가 필요 없다. UI 자체가 projecthub_v3 게이트(20260831180000)
--      안에 있어 모티브에만 보인다.
--   ② snapshot 을 왜 두는가: v3 표는 계속 변한다(할 일이 끝나고, 마감이 밀리고, 금액이 바뀐다).
--      보고는 '그 시점의 기록'이라 나중에 표가 변해도 그대로여야 한다. 그래서 만든 순간의
--      숫자(전체·끝남·지남·다음 마감·돈)를 jsonb 로 굳혀 담는다. 조인으로 다시 계산하면
--      지난주 보고가 이번주 숫자로 바뀌어 버려 기록의 뜻이 없어진다.
--   ③ 반례 — 신호등 없이 저장하면? 신호등이 곧 이 보고의 핵심이라(코멘트는 비어도 읽을 수 있지만
--      신호등이 없으면 아무 판단이 남지 않는다) check 로 막는다. blue/orange/red 셋만 받는다.
--
--   updated_at·트리거 없음 — 보고는 남긴 기록이라 수정하지 않는다(고칠 거면 그 주 보고를 새로
--   쓴다). 그래서 갱신 시각을 둘 이유가 없고 set_updated_at 트리거도 붙이지 않는다.

-- ─────────────────────────────────────────────────────────────
-- A. project_status_reports — 프로젝트별 상태 보고 기록
-- ─────────────────────────────────────────────────────────────
create table if not exists public.project_status_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  title text not null default '',                -- 예: '9월 1주 보고'
  signal text not null check (signal in ('blue','orange','red')),  -- 🔵순항/🟠주의/🔴지연 — 사람이 고른다
  comment text not null default '',              -- 한 줄 코멘트(사람)
  snapshot jsonb not null default '{}'::jsonb,   -- 만든 순간의 숫자(전체·끝남·지남·다음 마감·돈) — 그때 값 보존, 나중에 표가 변해도 보고는 그대로
  -- 저장 컨벤션은 이 저장소 표준대로 public.users(id) — auth.users 를 직접 참조하면
  -- PostgREST 로 만든 사람 이름을 조인할 수 없다. 형제 표(project_templates 20260831210000)와 동일.
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.project_status_reports is
  '프로젝트 v3 상태 보고 — 사람이 고른 신호등·코멘트 + 그 시점 숫자(snapshot). 남긴 기록이라 수정하지 않는다(updated_at 없음). 2026-09-02.';
comment on column public.project_status_reports.snapshot is
  '보고를 만든 순간의 숫자. 표가 나중에 변해도 이 값은 그대로 — 다시 계산하면 지난 보고가 이번 숫자로 바뀌어 기록의 뜻이 사라진다.';
comment on column public.project_status_reports.signal is
  '보고의 핵심. blue 순항 / orange 주의 / red 지연 — 사람이 고르고, 비워 둘 수 없다(check).';

-- 프로젝트 상세에서 최신 보고부터 읽는다
create index if not exists project_status_reports_deal_idx on public.project_status_reports (deal_id, created_at desc);
create index if not exists project_status_reports_company_idx on public.project_status_reports (company_id);

-- ─────────────────────────────────────────────────────────────
-- B. RLS — 형제 표 project_surveys(20260901170000)와 같은 회사 경계. 4종 명시(빠지면 기본 deny).
--    세무대리인 세션은 읽기 전용(RESTRICTIVE 3종) — 같은 문법.
-- ─────────────────────────────────────────────────────────────
alter table public.project_status_reports enable row level security;

drop policy if exists project_status_reports_select on public.project_status_reports;
create policy project_status_reports_select on public.project_status_reports
  for select to authenticated
  using (company_id = (select public.get_my_company_id()));

drop policy if exists project_status_reports_insert on public.project_status_reports;
create policy project_status_reports_insert on public.project_status_reports
  for insert to authenticated
  with check (company_id = (select public.get_my_company_id()));

-- update 정책은 형제 표와 같은 4종 관례로 두지만 화면은 쓰지 않는다 — 보고는 고치지 않고
-- 새로 쓴다(위 헤더 참조). 나중에 오타 정정 같은 예외를 열더라도 회사 경계는 이미 걸려 있다.
drop policy if exists project_status_reports_update on public.project_status_reports;
create policy project_status_reports_update on public.project_status_reports
  for update to authenticated
  using (company_id = (select public.get_my_company_id()))
  with check (company_id = (select public.get_my_company_id()));

drop policy if exists project_status_reports_delete on public.project_status_reports;
create policy project_status_reports_delete on public.project_status_reports
  for delete to authenticated
  using (company_id = (select public.get_my_company_id()));

drop policy if exists advisor_ro_ins on public.project_status_reports;
create policy advisor_ro_ins on public.project_status_reports as restrictive for insert to authenticated
  with check (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_upd on public.project_status_reports;
create policy advisor_ro_upd on public.project_status_reports as restrictive for update to authenticated
  using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_del on public.project_status_reports;
create policy advisor_ro_del on public.project_status_reports as restrictive for delete to authenticated
  using (not (select public.is_advisor_session()));

-- 시드 없음 — 보고는 사람이 화면에서 만든다.
