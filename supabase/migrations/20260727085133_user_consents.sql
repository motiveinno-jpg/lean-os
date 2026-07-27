-- 약관 동의 기록 (2026-07-27)
--   동의를 "막는" 것만으로는 분쟁 시 입증이 안 된다 — 누가·언제·어느 버전에 동의했는지 남긴다.
--   auth_id 기준: 가입 직후엔 public.users 행이 아직 없을 수 있어 user_id FK 로는 시점을 못 잡는다.

CREATE TABLE IF NOT EXISTS public.user_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id uuid NOT NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  consent_type text NOT NULL,
  document_versions jsonb NOT NULL,
  context jsonb,
  user_agent text,
  agreed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_consents_type_check
    CHECK (consent_type IN ('signup', 'annual_billing_no_refund'))
);

-- 가입 동의는 계정당 1건이면 충분 — 중복 호출(재시도·새로고침)돼도 늘어나지 않게.
--   결제 동의는 건마다 남아야 하므로 부분 인덱스로 'signup' 에만 적용한다.
CREATE UNIQUE INDEX IF NOT EXISTS user_consents_signup_once
  ON public.user_consents (auth_id) WHERE consent_type = 'signup';

CREATE INDEX IF NOT EXISTS idx_user_consents_auth
  ON public.user_consents (auth_id, agreed_at DESC);

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

-- 본인 동의 기록만 남기고 볼 수 있다. 수정·삭제는 누구도 불가(감사 기록이므로 append-only).
DROP POLICY IF EXISTS user_consents_insert_self ON public.user_consents;
CREATE POLICY user_consents_insert_self ON public.user_consents
  FOR INSERT TO authenticated
  WITH CHECK (auth_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS user_consents_select_own ON public.user_consents;
CREATE POLICY user_consents_select_own ON public.user_consents
  FOR SELECT TO authenticated
  USING (auth_id = (SELECT auth.uid()) OR (SELECT public.is_platform_operator()));
