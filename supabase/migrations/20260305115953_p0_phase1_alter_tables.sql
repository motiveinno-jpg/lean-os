-- Migration: p0_phase1_alter_tables
-- Version: 20260305115953
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- companies 테이블 확장
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS seal_url text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS business_number text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS representative text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS fax text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS business_type text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS business_category text;

-- employees 테이블 HR 마스터 필드 추가
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS department text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS position text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS job_title text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS job_grade text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS employment_type text DEFAULT 'full_time';
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS contract_start_date date;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS contract_end_date date;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS employee_number text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS bank_holder text;

-- documents 테이블 문서번호/직인 필드
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS document_number text;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS issued_at timestamptz;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS seal_applied boolean DEFAULT false;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS counterparty text;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS amount numeric DEFAULT 0;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS file_url text;

-- payment_queue에 comment/attachments 필드
ALTER TABLE public.payment_queue ADD COLUMN IF NOT EXISTS comment text;
ALTER TABLE public.payment_queue ADD COLUMN IF NOT EXISTS attachments text[] DEFAULT '{}';
