-- Migration: tax_invoice_automation_columns
-- Version: 20260310053445
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- 세금계산서 자동화를 위한 컬럼 추가
ALTER TABLE tax_invoices
  ADD COLUMN IF NOT EXISTS expense_category text,
  ADD COLUMN IF NOT EXISTS preferred_date date,
  ADD COLUMN IF NOT EXISTS nts_confirm_no text,
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS original_invoice_id uuid REFERENCES tax_invoices(id),
  ADD COLUMN IF NOT EXISTS modification_reason text,
  ADD COLUMN IF NOT EXISTS modification_date date,
  ADD COLUMN IF NOT EXISTS auto_issued boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS hometax_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- source: manual, hometax_sync, auto_deal, n8n
-- modification_reason: error_correction, contract_cancel, return, price_change, inland_lc, duplicate

COMMENT ON COLUMN tax_invoices.expense_category IS '비목 (goods, service, rent, commission, etc.)';
COMMENT ON COLUMN tax_invoices.preferred_date IS '거래처 희망 발행일';
COMMENT ON COLUMN tax_invoices.nts_confirm_no IS '국세청 승인번호';
COMMENT ON COLUMN tax_invoices.source IS '출처: manual, hometax_sync, auto_deal, n8n';
COMMENT ON COLUMN tax_invoices.original_invoice_id IS '수정세금계산서의 원본 계산서 ID';
COMMENT ON COLUMN tax_invoices.modification_reason IS '수정사유: error_correction, contract_cancel, return, price_change, inland_lc, duplicate';
COMMENT ON COLUMN tax_invoices.auto_issued IS '자동발행 여부';

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_tax_invoices_nts_confirm ON tax_invoices(nts_confirm_no) WHERE nts_confirm_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tax_invoices_source ON tax_invoices(source);
CREATE INDEX IF NOT EXISTS idx_tax_invoices_original ON tax_invoices(original_invoice_id) WHERE original_invoice_id IS NOT NULL;
