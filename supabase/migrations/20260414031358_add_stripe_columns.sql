-- Migration: add_stripe_columns
-- Version: 20260414031358
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- Stripe 결제 연동을 위한 컬럼 추가
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS stripe_invoice_id text;

-- Webhook에서 빠르게 조회하기 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub_id
  ON subscriptions (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_cust_id
  ON subscriptions (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
