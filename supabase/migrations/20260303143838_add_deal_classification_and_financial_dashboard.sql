-- Migration: add_deal_classification_and_financial_dashboard
-- Version: 20260303143838
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- 1) deals에 classification 컬럼 추가
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS classification text DEFAULT 'B2B';

-- 2) financial_items에 deal_id FK 추가 (드릴다운용)
ALTER TABLE public.financial_items ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES public.deals(id);

-- 3) 딜 분류 카테고리 테이블
CREATE TABLE IF NOT EXISTS public.deal_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  name text NOT NULL,
  color text DEFAULT '#3b82f6',
  sort_order integer DEFAULT 0,
  is_system boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- 4) RLS
ALTER TABLE public.deal_classifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deal_classifications_select" ON public.deal_classifications FOR SELECT
  USING (company_id = (SELECT get_my_company_id()));

CREATE POLICY "deal_classifications_insert" ON public.deal_classifications FOR INSERT
  WITH CHECK (company_id = (SELECT get_my_company_id()));

CREATE POLICY "deal_classifications_update" ON public.deal_classifications FOR UPDATE
  USING (company_id = (SELECT get_my_company_id()));

CREATE POLICY "deal_classifications_delete" ON public.deal_classifications FOR DELETE
  USING (company_id = (SELECT get_my_company_id()) AND is_system = false);

-- 5) 시스템 기본값 시드
INSERT INTO public.deal_classifications (company_id, name, color, sort_order, is_system)
SELECT c.id, v.name, v.color, v.ord, true
FROM public.companies c
CROSS JOIN (VALUES ('B2B', '#3b82f6', 1), ('B2C', '#22c55e', 2), ('B2G', '#f59e0b', 3)) AS v(name, color, ord);
