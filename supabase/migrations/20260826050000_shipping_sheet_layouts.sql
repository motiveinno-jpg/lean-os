-- 택배사 송장 양식 (2026-08-26 사장님 지시 — "택배사가 다양하니 모든 택배사 양식을 고를 수 있게")
--   ① 표준 양식은 코드(CARRIER_SHEETS)에, ② 회사가 만든 '내 양식'은 여기에. 열 = [{key, label}] 순서대로.
alter table public.channel_order_imports add column if not exists recipient_zip text;

create table if not exists public.shipping_sheet_layouts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  columns jsonb not null default '[]'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);
alter table public.shipping_sheet_layouts enable row level security;
drop policy if exists shipping_sheet_layouts_company on public.shipping_sheet_layouts;
create policy shipping_sheet_layouts_company on public.shipping_sheet_layouts for all
  using (company_id = (select public.get_my_company_id()))
  with check (company_id = (select public.get_my_company_id()));
drop policy if exists advisor_ro_ins on public.shipping_sheet_layouts;
create policy advisor_ro_ins on public.shipping_sheet_layouts for insert with check (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_upd on public.shipping_sheet_layouts;
create policy advisor_ro_upd on public.shipping_sheet_layouts for update using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_del on public.shipping_sheet_layouts;
create policy advisor_ro_del on public.shipping_sheet_layouts for delete using (not (select public.is_advisor_session()));
comment on table public.shipping_sheet_layouts is '회사가 만든 택배 송장 엑셀 양식 — 열 순서·머리글(columns jsonb [{key,label}])';
