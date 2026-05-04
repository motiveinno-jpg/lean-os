-- Migration: add_card_transactions_closing_checklists_rules
-- Version: 20260303152147
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- 1) 법인카드 테이블
CREATE TABLE IF NOT EXISTS public.corporate_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  card_name text NOT NULL,
  card_number text,
  card_company text NOT NULL DEFAULT '미지정',
  holder_name text,
  monthly_limit numeric DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.corporate_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON public.corporate_cards FOR ALL
  USING (company_id = (SELECT public.get_my_company_id()));

-- 2) 법인카드 거래내역
CREATE TABLE IF NOT EXISTS public.card_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  card_id uuid REFERENCES public.corporate_cards(id),
  transaction_date date NOT NULL,
  approval_number text,
  merchant_name text,
  merchant_category text,
  amount numeric NOT NULL DEFAULT 0,
  currency text DEFAULT 'KRW',
  installments integer DEFAULT 1,
  category text,
  classification text,
  deal_id uuid REFERENCES public.deals(id),
  tax_invoice_id uuid REFERENCES public.tax_invoices(id),
  is_fixed_cost boolean DEFAULT false,
  is_deductible boolean DEFAULT true,
  receipt_url text,
  mapping_status text DEFAULT 'unmapped' CHECK (mapping_status IN ('unmapped','auto_mapped','manual_mapped','ignored')),
  mapped_by uuid REFERENCES public.users(id),
  mapped_at timestamptz,
  source text DEFAULT 'manual',
  raw_data jsonb DEFAULT '{}',
  memo text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.card_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON public.card_transactions FOR ALL
  USING (company_id = (SELECT public.get_my_company_id()));

-- 3) 월 마감 체크리스트
CREATE TABLE IF NOT EXISTS public.closing_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  month text NOT NULL,
  status text DEFAULT 'open' CHECK (status IN ('open','in_progress','completed')),
  completed_at timestamptz,
  completed_by uuid REFERENCES public.users(id),
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(company_id, month)
);
ALTER TABLE public.closing_checklists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON public.closing_checklists FOR ALL
  USING (company_id = (SELECT public.get_my_company_id()));

-- 4) 체크리스트 항목
CREATE TABLE IF NOT EXISTS public.closing_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id uuid NOT NULL REFERENCES public.closing_checklists(id) ON DELETE CASCADE,
  sort_order integer DEFAULT 0,
  title text NOT NULL,
  description text,
  is_required boolean DEFAULT true,
  is_completed boolean DEFAULT false,
  completed_at timestamptz,
  completed_by uuid REFERENCES public.users(id),
  evidence_url text,
  evidence_note text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.closing_checklist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "checklist_access" ON public.closing_checklist_items FOR ALL
  USING (checklist_id IN (
    SELECT id FROM public.closing_checklists WHERE company_id = (SELECT public.get_my_company_id())
  ));

-- 5) 딜→인보이스→세금계산서→결제 매칭 추적 (bank_transactions에 연결 컬럼 추가)
ALTER TABLE public.bank_transactions ADD COLUMN IF NOT EXISTS tax_invoice_id uuid REFERENCES public.tax_invoices(id);
ALTER TABLE public.bank_transactions ADD COLUMN IF NOT EXISTS card_transaction_id uuid REFERENCES public.card_transactions(id);

-- 6) 수동 분류 → 자동 룰 학습 로그
ALTER TABLE public.bank_classification_rules ADD COLUMN IF NOT EXISTS learned_from_count integer DEFAULT 0;
ALTER TABLE public.bank_classification_rules ADD COLUMN IF NOT EXISTS last_learned_at timestamptz;
ALTER TABLE public.bank_classification_rules ADD COLUMN IF NOT EXISTS auto_generated boolean DEFAULT false;
