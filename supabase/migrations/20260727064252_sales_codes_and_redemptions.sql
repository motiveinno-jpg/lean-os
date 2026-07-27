-- 영업사원 영업코드 + 유입 추적 (2026-07-27 가격정책)
--   · 영업사원에게 코드를 발급하고, 카드등록(Stripe Checkout) 시 코드를 입력하면
--     기본 체험 14일 + 보너스 30일 = 44일.
--   · referral_codes 는 company_id NOT NULL 인 "고객사 추천인 코드"라 재사용 불가 → 별도 테이블.

CREATE TABLE IF NOT EXISTS public.sales_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  owner_name text NOT NULL,
  owner_email text,
  owner_phone text,
  memo text,
  bonus_trial_days integer NOT NULL DEFAULT 30,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_codes_code_format CHECK (code ~ '^[A-Z0-9-]{4,24}$'),
  CONSTRAINT sales_codes_bonus_range CHECK (bonus_trial_days BETWEEN 0 AND 365)
);

CREATE TABLE IF NOT EXISTS public.sales_code_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_code_id uuid NOT NULL REFERENCES public.sales_codes(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  applied_trial_days integer NOT NULL,
  stripe_subscription_id text,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  converted_at timestamptz,
  CONSTRAINT sales_code_redemptions_company_once UNIQUE (company_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_code_redemptions_code
  ON public.sales_code_redemptions (sales_code_id, redeemed_at DESC);

ALTER TABLE public.sales_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_code_redemptions ENABLE ROW LEVEL SECURITY;

-- 운영자만 읽고 쓴다. 일반 사용자는 코드 목록 자체를 볼 수 없다(코드 추측·수집 방지).
DROP POLICY IF EXISTS sales_codes_operator ON public.sales_codes;
CREATE POLICY sales_codes_operator ON public.sales_codes
  FOR ALL TO authenticated
  USING ((SELECT public.is_platform_operator()))
  WITH CHECK ((SELECT public.is_platform_operator()));

DROP POLICY IF EXISTS sales_code_redemptions_operator ON public.sales_code_redemptions;
CREATE POLICY sales_code_redemptions_operator ON public.sales_code_redemptions
  FOR SELECT TO authenticated
  USING ((SELECT public.is_platform_operator()));
-- INSERT/UPDATE 는 Stripe 웹훅(service_role)만 수행 — service_role 은 RLS 를 우회하므로
-- 별도 정책을 두지 않는다(= authenticated 는 쓰기 불가).

-- 코드 유효성 확인. 코드를 이미 아는 사람만 확인 가능하고, 목록 열람은 불가.
CREATE OR REPLACE FUNCTION public.sales_code_bonus_days(p_code text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT bonus_trial_days
    FROM sales_codes
   WHERE is_active AND code = upper(btrim(p_code))
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.sales_code_bonus_days(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_code_bonus_days(text) TO authenticated;

-- 운영자 화면: 어떤 영업코드로 어떤 회사가 가입했는지 + 현재 구독 상태
CREATE OR REPLACE FUNCTION public.operator_sales_code_signups()
RETURNS TABLE (
  code text,
  owner_name text,
  code_active boolean,
  company_id uuid,
  company_name text,
  business_number text,
  applied_trial_days integer,
  redeemed_at timestamptz,
  converted_at timestamptz,
  subscription_status text,
  plan_slug text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT sc.code, sc.owner_name, sc.is_active,
         c.id, c.name, c.business_number,
         r.applied_trial_days, r.redeemed_at, r.converted_at,
         s.status, s.plan_slug
    FROM sales_code_redemptions r
    JOIN sales_codes sc ON sc.id = r.sales_code_id
    JOIN companies c ON c.id = r.company_id
    LEFT JOIN LATERAL (
      SELECT status, plan_slug
        FROM subscriptions
       WHERE company_id = r.company_id
       ORDER BY created_at DESC
       LIMIT 1
    ) s ON true
   WHERE public.is_platform_operator()
   ORDER BY r.redeemed_at DESC;
$$;
REVOKE ALL ON FUNCTION public.operator_sales_code_signups() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operator_sales_code_signups() TO authenticated;
