-- Pricing restructure to 3 tiers (2026-07-01)
--   1) 14-day free trial (slug 'free', renamed) -> 2) basic 55,000 KRW flat monthly (VAT excl)
--   -> 3) enterprise (inquiry / custom). Legacy starter/pro deactivated (existing subs preserved).
--   Display base_price only; actual charge via Stripe PRICE_MAP (STRIPE_PRICE_BASIC_MONTHLY env).
--   subscription_plans has no updated_at column (created_at only).

begin;

-- deactivate legacy paid tiers (keep rows so existing subscriptions still resolve)
update public.subscription_plans set is_active = false where slug in ('starter', 'pro', 'business');

-- 1) 14-day free trial tier (was 'free' / 'Free')
update public.subscription_plans set
  name = '14일 무료체험',
  base_price = 0,
  per_seat_price = 0,
  is_active = true,
  sort_order = 0,
  features = '["14일간 전 기능 무료 체험","직원 3명 / 프로젝트 3개","전자서명 월 3건","AI 분석 월 5회","생존 대시보드","팀 채팅"]'::jsonb
where slug = 'free';

-- 2) basic 55,000 flat monthly (per-seat 0)
insert into public.subscription_plans
  (slug, name, base_price, per_seat_price, max_seats, max_employees, features, is_active, sort_order, semiannual_discount, annual_discount)
values
  ('basic', '기본요금제', 55000, 0, NULL, NULL,
   '["직원 / 프로젝트 무제한","4대 엔진 전체","전자서명 무제한","AI 분석 무제한","거래처 / 파트너 무제한","세무 리포트","우선 지원"]'::jsonb,
   true, 1, 0, 0)
on conflict (slug) do update set
  name = excluded.name,
  base_price = excluded.base_price,
  per_seat_price = excluded.per_seat_price,
  max_seats = excluded.max_seats,
  max_employees = excluded.max_employees,
  features = excluded.features,
  is_active = true,
  sort_order = 1;

-- 3) enterprise (inquiry) — keep, reorder last
update public.subscription_plans set
  name = '엔터프라이즈',
  is_active = true,
  sort_order = 2,
  features = '["기본요금제 전체 +","SSO / SAML","감사 로그 무제한","API 접근","전담 CSM","맞춤 개발","SLA 보장"]'::jsonb
where slug = 'enterprise';

commit;
