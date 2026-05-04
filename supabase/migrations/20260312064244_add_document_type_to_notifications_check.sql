-- Migration: add_document_type_to_notifications_check
-- Version: 20260312064244
-- Source: production schema_migrations (auto-extracted 2026-05-04)

ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY['deal_update'::text, 'expense_request'::text, 'contract_expiry'::text, 'signature_request'::text, 'payment_due'::text, 'system'::text, 'document'::text, 'approval'::text, 'chat'::text]));