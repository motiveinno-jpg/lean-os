-- AI 경영 브리핑 캐시 (생존 레이더 브리핑을 규칙 문장 → Claude 요약으로 승격, 2026-07-06).
--   비용 통제: 회사당 하루 1행. ai-briefing 엣지펑션이 service_role 로 upsert, 회사 멤버는 조회만.
--   프로덕션 Management API 선적용, 재현용 기록.
create table if not exists public.ai_briefings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  brief_date date not null,
  content text not null,
  created_at timestamptz not null default now(),
  unique (company_id, brief_date)
);
alter table public.ai_briefings enable row level security;
-- 회사 멤버만 자기 회사 브리핑 조회 (get_my_company_id SECURITY DEFINER — users 인라인 재귀 없음). 쓰기는 엣지(service_role)만.
drop policy if exists ai_briefings_company_select on public.ai_briefings;
create policy ai_briefings_company_select on public.ai_briefings
  for select using (company_id = (select public.get_my_company_id()));
