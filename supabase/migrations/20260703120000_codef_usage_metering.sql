-- CODEF usage metering (phase 1: measure only, no blocking)
-- Ledger of CODEF API consumption per edge-function invocation.
--   units       = billable product calls that succeeded (path /v1/kr/*, code CF-00000)
--   total_calls = every CODEF call incl. free management APIs (/v1/account/*) and failures
-- Inserted by codef-sync edge function with service_role (bypasses RLS).
-- Company members can only SELECT their own rows (usage gauge in billing page).

create table if not exists public.codef_usage (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies(id) on delete cascade,
  action      text not null,
  units       int  not null default 0,
  total_calls int  not null default 0,
  meta        jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_codef_usage_company_created
  on public.codef_usage (company_id, created_at desc);

alter table public.codef_usage enable row level security;

-- SELECT only for members of the same company. No INSERT/UPDATE/DELETE policies:
-- only service_role (edge function) writes.
drop policy if exists codef_usage_select on public.codef_usage;
create policy codef_usage_select on public.codef_usage
  for select using (company_id = public.get_my_company_id());

-- Plan quota column (null = unlimited / not enforced yet). Enforcement comes in phase 3.
alter table public.subscription_plans
  add column if not exists monthly_credits int;

comment on table public.codef_usage is 'CODEF API usage ledger (metering). units=billable success calls, total_calls=all calls.';
comment on column public.subscription_plans.monthly_credits is 'Monthly CODEF credit quota. null = unlimited (or not enforced).';
