-- Migration: phase_h_tax_views
-- Version: 20260304055753
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- 1) Tax Invoice Monthly Summary VIEW
CREATE OR REPLACE VIEW public.tax_invoice_monthly_summary AS
SELECT
  company_id,
  type,
  date_trunc('month', issue_date::date)::date AS month,
  COUNT(*) AS invoice_count,
  SUM(supply_amount) AS total_supply,
  SUM(tax_amount) AS total_tax,
  SUM(total_amount) AS total_amount
FROM public.tax_invoices
WHERE status != 'void'
GROUP BY company_id, type, date_trunc('month', issue_date::date);

-- 2) Card Deduction Summary VIEW
CREATE OR REPLACE VIEW public.card_deduction_summary AS
SELECT
  ct.company_id,
  date_trunc('month', ct.transaction_date::date)::date AS month,
  COUNT(*) AS tx_count,
  SUM(ct.amount) AS total_amount,
  SUM(CASE WHEN ct.is_deductible THEN ct.amount ELSE 0 END) AS deductible_amount,
  SUM(CASE WHEN NOT ct.is_deductible THEN ct.amount ELSE 0 END) AS non_deductible_amount,
  SUM(CASE WHEN ct.is_deductible THEN ct.amount * 0.1 ELSE 0 END) AS estimated_vat_deduction
FROM public.card_transactions ct
GROUP BY ct.company_id, date_trunc('month', ct.transaction_date::date);

-- 3) Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_tax_invoices_issue_date ON public.tax_invoices(issue_date);
CREATE INDEX IF NOT EXISTS idx_card_transactions_tx_date ON public.card_transactions(transaction_date);
