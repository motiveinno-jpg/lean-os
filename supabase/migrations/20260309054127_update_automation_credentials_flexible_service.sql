-- Migration: update_automation_credentials_flexible_service
-- Version: 20260309054127
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- service 제약 제거 (다양한 은행/카드사 지원)
ALTER TABLE automation_credentials DROP CONSTRAINT IF EXISTS automation_credentials_service_check;
-- unique도 제거 후 재생성 (bank_ibk_0, card_lottecard_0 등 복수 지원)
ALTER TABLE automation_credentials DROP CONSTRAINT IF EXISTS automation_credentials_company_id_service_key;
-- 새 unique: company_id + service (service에 인덱스 번호 포함)
ALTER TABLE automation_credentials ADD CONSTRAINT automation_credentials_company_id_service_key UNIQUE(company_id, service);
