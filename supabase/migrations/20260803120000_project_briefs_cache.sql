-- 프로젝트 AI 브리핑 캐시 (2026-08-03 사장님 지시: 프로젝트 상단에 짧은 상태 한 줄 대신
--   "지금 어떤 상태이고 · 뭐가 잘되고 · 뭐가 문제고 · 뭘 하면 되는지" AI 분석 브리핑).
--   비용 통제: 프로젝트당 하루 1행. project-brief 엣지펑션이 service_role 로 upsert,
--   회사 멤버는 조회만(ai_briefings 와 동일한 패턴).
create table if not exists public.project_briefs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  brief_date date not null,
  -- headline/state/goods[]/issues[]/nexts[] 구조화 결과
  content jsonb not null,
  created_at timestamptz not null default now(),
  unique (deal_id, brief_date)
);
alter table public.project_briefs enable row level security;
-- 회사 멤버만 자기 회사 프로젝트 브리핑 조회. 쓰기는 엣지(service_role)만.
drop policy if exists project_briefs_company_select on public.project_briefs;
create policy project_briefs_company_select on public.project_briefs
  for select using (company_id = (select public.get_my_company_id()));
create index if not exists project_briefs_deal_date_idx on public.project_briefs (deal_id, brief_date desc);
