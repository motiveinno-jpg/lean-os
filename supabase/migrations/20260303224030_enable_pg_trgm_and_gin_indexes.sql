-- Migration: enable_pg_trgm_and_gin_indexes
-- Version: 20260303224030
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- 3) pg_trgm 확장 + GIN 전문검색 인덱스
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- deals.name
CREATE INDEX idx_deals_name_trgm ON public.deals USING gin (name gin_trgm_ops);

-- documents.name
CREATE INDEX idx_documents_name_trgm ON public.documents USING gin (name gin_trgm_ops);

-- partners.name
CREATE INDEX idx_partners_name_trgm ON public.partners USING gin (name gin_trgm_ops);

-- tax_invoices.counterparty_name
CREATE INDEX idx_tax_invoices_counterparty_trgm ON public.tax_invoices USING gin (counterparty_name gin_trgm_ops);

-- bank_transactions.counterparty
CREATE INDEX idx_bank_transactions_counterparty_trgm ON public.bank_transactions USING gin (counterparty gin_trgm_ops);

-- chat_messages.content
CREATE INDEX idx_chat_messages_content_trgm ON public.chat_messages USING gin (content gin_trgm_ops);

-- employees.name
CREATE INDEX idx_employees_name_trgm ON public.employees USING gin (name gin_trgm_ops);
