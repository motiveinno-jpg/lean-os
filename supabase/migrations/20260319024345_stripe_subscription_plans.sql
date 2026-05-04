-- Migration: stripe_subscription_plans
-- Version: 20260319024345
-- Source: production schema_migrations (auto-extracted 2026-05-04)

-- 1. subscription_plans 테이블에 stripe 관련 컬럼 추가
ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS stripe_price_monthly TEXT,
  ADD COLUMN IF NOT EXISTS stripe_price_semiannual TEXT,
  ADD COLUMN IF NOT EXISTS stripe_price_annual TEXT,
  ADD COLUMN IF NOT EXISTS stripe_product_id TEXT,
  ADD COLUMN IF NOT EXISTS max_employees INT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS semiannual_discount NUMERIC(3,2) DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS annual_discount NUMERIC(3,2) DEFAULT 0.20;

-- 2. subscriptions 테이블에 stripe 관련 컬럼 추가
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_price_id TEXT,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS plan_slug TEXT;

-- 3. companies 테이블에 stripe_customer_id 추가
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- 4. slug unique constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscription_plans_slug_key'
  ) THEN
    ALTER TABLE subscription_plans ADD CONSTRAINT subscription_plans_slug_key UNIQUE (slug);
  END IF;
END $$;

-- 5. 기존 플랜 비활성화 후 새 플랜 삽입
UPDATE subscription_plans SET is_active = false WHERE is_active = true;

INSERT INTO subscription_plans (
  slug, name, base_price, per_seat_price, max_seats, max_employees,
  features, is_active, sort_order,
  semiannual_discount, annual_discount
) VALUES
  ('free', 'Free', 0, 0, 3, 3,
   '["대시보드 조회","직원 3명","프로젝트 2개","전자서명 월 3건","AI 분석 월 5회","팀 채팅"]'::jsonb,
   true, 1, 0.10, 0.20),
  ('starter', 'Starter', 49000, 0, 10, 10,
   '["직원 10명","딜 파이프라인","기본 리포트","전자서명 월 30건","AI 분석 월 50회","파트너 10개","이메일 지원"]'::jsonb,
   true, 2, 0.10, 0.20),
  ('pro', 'Pro', 149000, 0, NULL, NULL,
   '["직원 무제한","AI 분석 무제한","고급 리포트","API 접근","급여 자동정산","서명 무제한","자동화 무제한","파트너 무제한","세무 리포트","우선 지원"]'::jsonb,
   true, 3, 0.10, 0.20),
  ('enterprise', 'Enterprise', 299000, 0, NULL, NULL,
   '["Pro 전체 기능","SSO/SAML","감사 로그 무제한","전담 CSM","맞춤 개발","SLA 보장","전담 지원"]'::jsonb,
   true, 4, 0.10, 0.20)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  base_price = EXCLUDED.base_price,
  per_seat_price = EXCLUDED.per_seat_price,
  max_seats = EXCLUDED.max_seats,
  max_employees = EXCLUDED.max_employees,
  features = EXCLUDED.features,
  is_active = true,
  sort_order = EXCLUDED.sort_order,
  semiannual_discount = EXCLUDED.semiannual_discount,
  annual_discount = EXCLUDED.annual_discount;