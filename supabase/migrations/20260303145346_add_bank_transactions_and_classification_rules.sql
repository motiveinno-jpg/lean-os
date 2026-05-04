-- Migration: add_bank_transactions_and_classification_rules
-- Version: 20260303145346
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- 1) 은행 거래내역 테이블
CREATE TABLE public.bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  bank_account_id uuid REFERENCES public.bank_accounts(id),
  transaction_date date NOT NULL,
  amount numeric NOT NULL,
  balance_after numeric,
  type text NOT NULL CHECK (type IN ('income', 'expense')),
  counterparty text,
  description text,
  memo text,
  -- 자동분류 결과
  deal_id uuid REFERENCES public.deals(id),
  classification text,
  category text,  -- 고정비/변동비/매출/기타
  is_fixed_cost boolean DEFAULT false,
  -- 매핑 상태
  mapping_status text DEFAULT 'unmapped' CHECK (mapping_status IN ('unmapped', 'auto_mapped', 'manual_mapped', 'ignored')),
  mapped_by uuid REFERENCES public.users(id),
  mapped_at timestamptz,
  -- 메타
  source text DEFAULT 'n8n',  -- n8n, csv_upload, manual
  raw_data jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON public.bank_transactions FOR ALL
  USING (company_id = (SELECT get_my_company_id()));

CREATE INDEX idx_bank_tx_company_date ON public.bank_transactions(company_id, transaction_date DESC);
CREATE INDEX idx_bank_tx_mapping ON public.bank_transactions(company_id, mapping_status);

-- 2) 자동 분류 규칙 테이블
CREATE TABLE public.bank_classification_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  rule_name text NOT NULL,
  match_type text NOT NULL CHECK (match_type IN ('exact', 'contains', 'regex')),
  match_field text NOT NULL CHECK (match_field IN ('counterparty', 'description', 'memo')),
  match_value text NOT NULL,
  -- 분류 결과
  assign_category text,        -- 고정비/변동비/매출/기타
  assign_classification text,  -- B2B/B2C/B2G
  assign_deal_id uuid REFERENCES public.deals(id),
  is_fixed_cost boolean DEFAULT false,
  -- 메타
  priority integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.bank_classification_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON public.bank_classification_rules FOR ALL
  USING (company_id = (SELECT get_my_company_id()));

-- 3) 접근 로그 테이블
CREATE TABLE public.finance_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  user_id uuid NOT NULL REFERENCES public.users(id),
  action text NOT NULL,  -- view_transactions, export, map_transaction, etc.
  resource_type text,
  resource_id uuid,
  ip_address text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.finance_access_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON public.finance_access_logs FOR ALL
  USING (company_id = (SELECT get_my_company_id()));
