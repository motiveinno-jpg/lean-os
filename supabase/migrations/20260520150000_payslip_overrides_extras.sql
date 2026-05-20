ALTER TABLE public.payslip_overrides
  ADD COLUMN IF NOT EXISTS extras jsonb DEFAULT '[]'::jsonb;
COMMENT ON COLUMN public.payslip_overrides.extras IS 'v4 H1: 월별 임의 수당/공제 라인 [{type,name,amount}]. payslip_overrides 본인격리 RLS 동일 적용.';
