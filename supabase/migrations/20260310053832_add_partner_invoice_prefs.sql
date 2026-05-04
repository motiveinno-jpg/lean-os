-- Migration: add_partner_invoice_prefs
-- Version: 20260310053832
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- 거래처별 세금계산서 설정
ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS preferred_invoice_day int,
  ADD COLUMN IF NOT EXISTS default_expense_category text,
  ADD COLUMN IF NOT EXISTS company_name text;

COMMENT ON COLUMN partners.preferred_invoice_day IS '희망 세금계산서 발행일 (1~31)';
COMMENT ON COLUMN partners.default_expense_category IS '기본 비목';
COMMENT ON COLUMN partners.company_name IS '법인명 (상호)';

-- 기존 partners에 company_name 을 name에서 복사
UPDATE partners SET company_name = name WHERE company_name IS NULL;
