-- ============================================================
-- Cash Budget / Treasury Management tables (resurrect for cash-budget.ts)
-- /reports/flow and /reports/costs reference these; they were defined only in
-- _legacy_local and never shipped to prod. RLS uses the standard SECURITY DEFINER
-- helper get_my_company_id() (NOT the legacy inline users subquery).
-- ============================================================

-- ---- fixed_costs ----
CREATE TABLE IF NOT EXISTS public.fixed_costs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  name text NOT NULL,
  amount bigint NOT NULL DEFAULT 0,
  payment_day integer NOT NULL DEFAULT 1 CHECK (payment_day BETWEEN 1 AND 31),
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('office','insurance','loan','salary','subscription','tax','other')),
  is_recurring boolean NOT NULL DEFAULT true,
  start_date date,
  end_date date,
  note text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fixed_costs_company ON public.fixed_costs(company_id, category);
CREATE INDEX IF NOT EXISTS idx_fixed_costs_payment_day ON public.fixed_costs(company_id, payment_day);
ALTER TABLE public.fixed_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_access" ON public.fixed_costs;
CREATE POLICY "company_access" ON public.fixed_costs
  FOR ALL USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());

-- ---- owner_injections ----
CREATE TABLE IF NOT EXISTS public.owner_injections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  amount bigint NOT NULL DEFAULT 0,
  date date NOT NULL DEFAULT CURRENT_DATE,
  note text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_owner_injections_company ON public.owner_injections(company_id, date DESC);
ALTER TABLE public.owner_injections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_access" ON public.owner_injections;
CREATE POLICY "company_access" ON public.owner_injections
  FOR ALL USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());

-- ---- cash_projections ----
CREATE TABLE IF NOT EXISTS public.cash_projections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  month text NOT NULL,
  projection_data jsonb NOT NULL DEFAULT '{}',
  generated_at timestamptz DEFAULT now(),
  generated_by uuid REFERENCES public.users(id)
);
CREATE INDEX IF NOT EXISTS idx_cash_projections_company ON public.cash_projections(company_id, month DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_projections_unique ON public.cash_projections(company_id, month);
ALTER TABLE public.cash_projections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_access" ON public.cash_projections;
CREATE POLICY "company_access" ON public.cash_projections
  FOR ALL USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id());
