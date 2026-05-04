-- Migration: phase_l_approval_center
-- Version: 20260304125645
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- Phase L: CEO 승인센터 + 결제 배치 인프라
-- 1) approval_policies: 승인 정책 (금액별/유형별)
CREATE TABLE public.approval_policies (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  entity_type text NOT NULL,
  min_amount numeric DEFAULT 0,
  max_amount numeric DEFAULT 999999999,
  required_role text DEFAULT 'owner',
  auto_approve boolean DEFAULT false,
  auto_approve_threshold numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.approval_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "approval_policies_company" ON public.approval_policies
  FOR ALL USING (company_id = public.get_my_company_id());
CREATE INDEX idx_approval_policies_company ON public.approval_policies(company_id);

-- 2) recurring_payments: 반복 결제 (고정비/구독)
CREATE TABLE public.recurring_payments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  name text NOT NULL,
  amount numeric NOT NULL,
  category text NOT NULL DEFAULT 'rent',
  recipient_name text,
  recipient_account text,
  recipient_bank text,
  bank_account_id uuid REFERENCES public.bank_accounts(id),
  frequency text DEFAULT 'monthly',
  day_of_month integer DEFAULT 25,
  is_active boolean DEFAULT true,
  last_generated_at timestamptz,
  next_due_date date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.recurring_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recurring_payments_company" ON public.recurring_payments
  FOR ALL USING (company_id = public.get_my_company_id());
CREATE INDEX idx_recurring_payments_company ON public.recurring_payments(company_id);
CREATE INDEX idx_recurring_payments_active ON public.recurring_payments(company_id, is_active);

-- 3) payment_batches: 결제 묶음 (급여/고정비)
CREATE TABLE public.payment_batches (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  name text NOT NULL,
  batch_type text NOT NULL DEFAULT 'manual',
  total_amount numeric DEFAULT 0,
  item_count integer DEFAULT 0,
  status text DEFAULT 'draft',
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  executed_at timestamptz,
  n8n_execution_id text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.payment_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payment_batches_company" ON public.payment_batches
  FOR ALL USING (company_id = public.get_my_company_id());
CREATE INDEX idx_payment_batches_company ON public.payment_batches(company_id);
CREATE INDEX idx_payment_batches_status ON public.payment_batches(company_id, status);

-- 4) ALTER payment_queue: 배치/반복/수취인 정보 추가
ALTER TABLE public.payment_queue
  ADD COLUMN IF NOT EXISTS payment_type text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES public.deals(id),
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS recipient_name text,
  ADD COLUMN IF NOT EXISTS recipient_account text,
  ADD COLUMN IF NOT EXISTS recipient_bank text,
  ADD COLUMN IF NOT EXISTS is_recurring boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurring_rule_id uuid,
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.payment_batches(id),
  ADD COLUMN IF NOT EXISTS transfer_ref text,
  ADD COLUMN IF NOT EXISTS n8n_execution_id text;

-- 5) 기본 승인 정책 시드 (모티브이노베이션)
INSERT INTO public.approval_policies (company_id, entity_type, min_amount, max_amount, required_role, auto_approve, auto_approve_threshold)
VALUES
  ('c361afb9-8a52-4cac-add9-8992f0f7c09c', 'expense', 0, 100000, 'owner', true, 100000),
  ('c361afb9-8a52-4cac-add9-8992f0f7c09c', 'expense', 100001, 999999999, 'owner', false, 0),
  ('c361afb9-8a52-4cac-add9-8992f0f7c09c', 'payment', 0, 999999999, 'owner', false, 0),
  ('c361afb9-8a52-4cac-add9-8992f0f7c09c', 'document', 0, 999999999, 'owner', false, 0),
  ('c361afb9-8a52-4cac-add9-8992f0f7c09c', 'leave', 0, 999999999, 'owner', false, 0);
