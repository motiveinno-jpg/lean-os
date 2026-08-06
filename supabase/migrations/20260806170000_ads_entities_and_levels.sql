-- 광고 계층(캠페인 > 광고그룹 > 소재)과 소재 정보 (2026-08-06). prod 적용 완료(MCP apply_migration).
--   실계정 조사로 확인: 광고그룹·소재 조회 가능(단, 소재·키워드는 광고그룹 id 로 물어야 한다),
--   쇼핑검색광고는 소재에 상품 이미지 URL·상품명·가격이 온다.
create table if not exists public.ad_entities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,
  level text not null check (level in ('campaign','adgroup','ad')),
  entity_id text not null,
  parent_id text,
  name text,
  status text,
  daily_budget numeric,
  ad_type text,
  image_url text,
  link_url text,
  price numeric,
  meta jsonb,
  updated_at timestamptz not null default now()
);
create unique index if not exists ad_entities_uniq on public.ad_entities(ad_account_id, level, entity_id);
create index if not exists ad_entities_parent on public.ad_entities(ad_account_id, parent_id);
alter table public.ad_entities enable row level security;
drop policy if exists ad_entities_read on public.ad_entities;
create policy ad_entities_read on public.ad_entities
  for select using (company_id = public.get_my_company_id());

alter table public.ad_metrics_daily add column if not exists level text not null default 'campaign';
alter table public.ad_metrics_daily add column if not exists entity_id text;
update public.ad_metrics_daily set entity_id = campaign_id where entity_id is null;
alter table public.ad_metrics_daily alter column entity_id set not null;
drop index if exists public.ad_metrics_daily_uniq;
create unique index if not exists ad_metrics_daily_uniq2
  on public.ad_metrics_daily(ad_account_id, level, entity_id, stat_date);
create index if not exists ad_metrics_daily_level on public.ad_metrics_daily(company_id, level, stat_date desc);
