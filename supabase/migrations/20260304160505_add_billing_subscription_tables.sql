-- Migration: add_billing_subscription_tables
-- Version: 20260304160505
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- ═══════════════════════════════════════════
-- Phase P: 결제 + 구독 + 피드백 시스템
-- ═══════════════════════════════════════════

-- 1. subscription_plans: 요금제 정의
CREATE TABLE public.subscription_plans (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  base_price integer NOT NULL DEFAULT 0,
  per_seat_price integer NOT NULL DEFAULT 0,
  max_seats integer,
  features jsonb DEFAULT '[]',
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read active plans" ON public.subscription_plans FOR SELECT USING (is_active = true);

-- 2. subscriptions: 회사별 구독 현황
CREATE TABLE public.subscriptions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id),
  status text NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing','active','past_due','canceled','paused')),
  seat_count integer NOT NULL DEFAULT 1,
  billing_cycle text DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','annual')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  toss_customer_key text,
  toss_billing_key text,
  canceled_at timestamptz,
  cancel_reason text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own company subscription" ON public.subscriptions FOR SELECT USING (
  company_id IN (SELECT company_id FROM public.users WHERE auth_id = auth.uid())
);
CREATE POLICY "Owners can manage subscription" ON public.subscriptions FOR ALL USING (
  company_id IN (SELECT company_id FROM public.users WHERE auth_id = auth.uid() AND role IN ('owner','admin'))
);

-- 3. invoices: 청구서/영수증
CREATE TABLE public.invoices (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  subscription_id uuid REFERENCES public.subscriptions(id),
  invoice_number text NOT NULL,
  amount integer NOT NULL,
  tax_amount integer NOT NULL DEFAULT 0,
  total_amount integer NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded','canceled')),
  toss_payment_key text,
  toss_order_id text,
  paid_at timestamptz,
  description text,
  billing_period_start timestamptz,
  billing_period_end timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own invoices" ON public.invoices FOR SELECT USING (
  company_id IN (SELECT company_id FROM public.users WHERE auth_id = auth.uid())
);
CREATE POLICY "System can manage invoices" ON public.invoices FOR ALL USING (
  company_id IN (SELECT company_id FROM public.users WHERE auth_id = auth.uid() AND role IN ('owner','admin'))
);

-- 4. billing_events: 결제 이벤트 로그
CREATE TABLE public.billing_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  event_type text NOT NULL CHECK (event_type IN ('payment_success','payment_failed','plan_changed','subscription_created','subscription_canceled','subscription_paused','subscription_resumed','refund','trial_started','trial_ended','seat_changed')),
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own billing events" ON public.billing_events FOR SELECT USING (
  company_id IN (SELECT company_id FROM public.users WHERE auth_id = auth.uid())
);
CREATE POLICY "System can insert billing events" ON public.billing_events FOR INSERT WITH CHECK (
  company_id IN (SELECT company_id FROM public.users WHERE auth_id = auth.uid())
);

-- 5. referral_codes: 추천인 코드
CREATE TABLE public.referral_codes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  code text NOT NULL UNIQUE,
  referred_count integer DEFAULT 0,
  credit_earned integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own referral codes" ON public.referral_codes FOR SELECT USING (
  company_id IN (SELECT company_id FROM public.users WHERE auth_id = auth.uid())
);
CREATE POLICY "Owners can manage referral codes" ON public.referral_codes FOR ALL USING (
  company_id IN (SELECT company_id FROM public.users WHERE auth_id = auth.uid() AND role IN ('owner','admin'))
);

-- 6. feedback: 피드백 시스템
CREATE TABLE public.feedback (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  user_id uuid NOT NULL REFERENCES public.users(id),
  category text NOT NULL CHECK (category IN ('feature_request','bug_report','ux_improvement','general','billing')),
  title text NOT NULL,
  description text,
  status text DEFAULT 'pending' CHECK (status IN ('pending','reviewed','planned','in_progress','done','rejected')),
  admin_note text,
  priority integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own feedback" ON public.feedback FOR SELECT USING (
  company_id IN (SELECT company_id FROM public.users WHERE auth_id = auth.uid())
);
CREATE POLICY "Users can create feedback" ON public.feedback FOR INSERT WITH CHECK (
  company_id IN (SELECT company_id FROM public.users WHERE auth_id = auth.uid())
);
CREATE POLICY "Users can update own feedback" ON public.feedback FOR UPDATE USING (
  user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
);

-- Seed default plans
INSERT INTO public.subscription_plans (name, slug, base_price, per_seat_price, max_seats, sort_order, features) VALUES
  ('Free', 'free', 0, 0, 3, 0, '["직원 3명","프로젝트 3개","전자서명 월 3건","생존 대시보드","AI 분석 월 5회","팀 채팅"]'),
  ('Starter', 'starter', 29000, 5900, 10, 1, '["직원/프로젝트 무제한","4개 엔진 전체","서명 월 50건","AI 분석 월 100회","파트너 10개","거래처 DB 무제한","이메일 지원"]'),
  ('Business', 'business', 49000, 9900, 50, 2, '["Starter 전체 +","AI 무제한","급여 자동정산","서명 무제한","자동화 무제한","파트너 무제한","세무 리포트","생존 시뮬레이터","우선 지원"]'),
  ('Enterprise', 'enterprise', 0, 0, NULL, 3, '["Business 전체 +","SSO/SAML","감사 로그 무제한","API 접근","전담 CSM","맞춤 개발","SLA 보장","온프레미스 옵션"]');

-- Add subscription_id to companies for quick lookup
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS current_plan text DEFAULT 'free';
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz DEFAULT (now() + interval '14 days');
