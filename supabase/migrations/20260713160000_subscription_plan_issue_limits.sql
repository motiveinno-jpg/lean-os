-- Plan-level monthly issuance limits for 국세청 발행 (NTS e-issuance).
-- basic(기본요금제, 55,000): 월 10건씩 제한. ultra(88,000)/enterprise: 무제한(NULL).
-- NULL = unlimited / not enforced. Mirrors existing monthly_credits (CODEF) quota pattern.
-- No RLS change: subscription_plans already has public-read policy; these are plain quota columns.

alter table public.subscription_plans
  add column if not exists monthly_tax_invoice_limit int;

alter table public.subscription_plans
  add column if not exists monthly_cashbill_limit int;

comment on column public.subscription_plans.monthly_tax_invoice_limit is
  '세금계산서(국세청 전자발행) 월 발행 한도. NULL = 무제한.';
comment on column public.subscription_plans.monthly_cashbill_limit is
  '현금영수증(국세청 발행) 월 발행 한도. NULL = 무제한.';

-- Seed limits by slug. starter/pro (inactive) left untouched.
update public.subscription_plans
  set monthly_tax_invoice_limit = 3, monthly_cashbill_limit = 3
  where slug = 'free';

update public.subscription_plans
  set monthly_tax_invoice_limit = 10, monthly_cashbill_limit = 10
  where slug = 'basic';

update public.subscription_plans
  set monthly_tax_invoice_limit = null, monthly_cashbill_limit = null
  where slug in ('ultra', 'enterprise');
