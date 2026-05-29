-- Migration: signature_send_failures (서명 발송 실패 로깅 테이블 + RPC 4종)
-- Version: 20260529110000
-- Author: db-architect
-- 사전 확인:
--   * 헬퍼: public.get_my_company_id() (20260303103954) + public.is_company_admin() (20260519040000) 사용
--     (핸드오프의 is_admin_or_owner 는 미존재 — is_company_admin 으로 대체. role IN ('owner','admin') 동일 의미)
--   * users.company_id / users.role / users.auth_id 존재 (enum 아닌 text, 'owner'|'admin'|'employee' 등)
--   * partners(id), signature_requests(id) FK 가능 (companies, partners 모두 company_id 보유)
-- 정책:
--   * SELECT — 회사 격리 + admin/owner 만 조회 (집계용 RPC 도 동일 게이트)
--   * INSERT — 회사 격리 (직원도 본인 발송 실패 기록 가능, RPC log_signature_send_failure 통해 권장)
--   * UPDATE — 회사 격리 + admin/owner (재시도 표기 mark_failure_retried 통해)
--   * DELETE — 정책 미부여 = deny (감사 로그 보존, 회사 삭제 시만 ON DELETE CASCADE)
-- 재귀 안전: 정책 본문에 users/employees 인라인 서브쿼리 0건 — SECURITY DEFINER 헬퍼만.

SET statement_timeout = '30000';
SET lock_timeout = '4000';

-- ─────────────────────────────────────────────────────────────────────────
-- 1) 테이블
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.signature_send_failures (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  signature_request_id  uuid REFERENCES public.signature_requests(id) ON DELETE CASCADE,
  batch_id              uuid,
  partner_id            uuid REFERENCES public.partners(id),
  recipient_email       text NOT NULL,
  recipient_name        text,
  send_type             text NOT NULL CHECK (send_type IN ('initial','reminder','bulk_initial')),
  error_code            text NOT NULL,
  error_message         text NOT NULL,
  retried               boolean NOT NULL DEFAULT false,
  retried_at            timestamptz,
  retried_request_id    uuid REFERENCES public.signature_requests(id),
  failed_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS signature_send_failures_company_failed_at_idx
  ON public.signature_send_failures (company_id, failed_at DESC);
CREATE INDEX IF NOT EXISTS signature_send_failures_company_code_failed_at_idx
  ON public.signature_send_failures (company_id, error_code, failed_at DESC);
CREATE INDEX IF NOT EXISTS signature_send_failures_request_id_idx
  ON public.signature_send_failures (signature_request_id);
CREATE INDEX IF NOT EXISTS signature_send_failures_batch_id_idx
  ON public.signature_send_failures (batch_id) WHERE batch_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) RLS
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.signature_send_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_send_failures FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ssf_select_company_admin" ON public.signature_send_failures;
CREATE POLICY "ssf_select_company_admin" ON public.signature_send_failures
  FOR SELECT
  USING (
    company_id = public.get_my_company_id()
    AND public.is_company_admin()
  );

DROP POLICY IF EXISTS "ssf_insert_company" ON public.signature_send_failures;
CREATE POLICY "ssf_insert_company" ON public.signature_send_failures
  FOR INSERT
  WITH CHECK (
    company_id = public.get_my_company_id()
  );

DROP POLICY IF EXISTS "ssf_update_company_admin" ON public.signature_send_failures;
CREATE POLICY "ssf_update_company_admin" ON public.signature_send_failures
  FOR UPDATE
  USING (
    company_id = public.get_my_company_id()
    AND public.is_company_admin()
  )
  WITH CHECK (
    company_id = public.get_my_company_id()
    AND public.is_company_admin()
  );

-- DELETE 정책 부여 안 함 = deny by default (감사 로그 보존)

-- ─────────────────────────────────────────────────────────────────────────
-- 3) RPC #1: 최근 N일 에러코드별 집계 (admin/owner)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_recent_send_failures_summary(
  p_days int DEFAULT 7
)
RETURNS TABLE (
  error_code        text,
  count             bigint,
  latest_failed_at  timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    f.error_code,
    COUNT(*)::bigint AS count,
    MAX(f.failed_at) AS latest_failed_at
  FROM public.signature_send_failures f
  WHERE f.company_id = public.get_my_company_id()
    AND public.is_company_admin()
    AND f.retried = false
    AND f.failed_at >= now() - make_interval(days => GREATEST(COALESCE(p_days, 7), 1))
  GROUP BY f.error_code
  ORDER BY count DESC, latest_failed_at DESC;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) RPC #2: 에러코드 상세 목록 (admin/owner)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_send_failures_by_code(
  p_error_code text,
  p_days int DEFAULT 7
)
RETURNS SETOF public.signature_send_failures
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f.*
  FROM public.signature_send_failures f
  WHERE f.company_id = public.get_my_company_id()
    AND public.is_company_admin()
    AND f.error_code = p_error_code
    AND f.retried = false
    AND f.failed_at >= now() - make_interval(days => GREATEST(COALESCE(p_days, 7), 1))
  ORDER BY f.failed_at DESC
  LIMIT 100;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) RPC #3: 실패 기록 등록 (회사 자동 추론)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_signature_send_failure(
  p_signature_request_id uuid,
  p_batch_id             uuid,
  p_partner_id           uuid,
  p_recipient_email      text,
  p_recipient_name       text,
  p_send_type            text,
  p_error_code           text,
  p_error_message        text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_id         uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  v_company_id := public.get_my_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'COMPANY_NOT_RESOLVED';
  END IF;

  IF p_send_type IS NULL OR p_send_type NOT IN ('initial','reminder','bulk_initial') THEN
    RAISE EXCEPTION 'INVALID_SEND_TYPE: %', p_send_type;
  END IF;

  IF p_recipient_email IS NULL OR length(btrim(p_recipient_email)) = 0 THEN
    RAISE EXCEPTION 'RECIPIENT_EMAIL_REQUIRED';
  END IF;

  IF p_error_code IS NULL OR length(btrim(p_error_code)) = 0 THEN
    RAISE EXCEPTION 'ERROR_CODE_REQUIRED';
  END IF;

  INSERT INTO public.signature_send_failures (
    company_id,
    signature_request_id,
    batch_id,
    partner_id,
    recipient_email,
    recipient_name,
    send_type,
    error_code,
    error_message
  ) VALUES (
    v_company_id,
    p_signature_request_id,
    p_batch_id,
    p_partner_id,
    p_recipient_email,
    p_recipient_name,
    p_send_type,
    p_error_code,
    COALESCE(p_error_message, '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) RPC #4: 재시도 표기 (admin/owner)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_failure_retried(
  p_failure_id     uuid,
  p_new_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_updated    int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  IF NOT public.is_company_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: admin/owner only';
  END IF;

  v_company_id := public.get_my_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'COMPANY_NOT_RESOLVED';
  END IF;

  IF p_failure_id IS NULL THEN
    RAISE EXCEPTION 'FAILURE_ID_REQUIRED';
  END IF;

  UPDATE public.signature_send_failures
     SET retried            = true,
         retried_at         = now(),
         retried_request_id = p_new_request_id
   WHERE id = p_failure_id
     AND company_id = v_company_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'FAILURE_NOT_FOUND_OR_FORBIDDEN';
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) GRANT — anon 제거, authenticated 만 실행 가능
-- ─────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.get_recent_send_failures_summary(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_send_failures_by_code(text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_signature_send_failure(uuid, uuid, uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_failure_retried(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_recent_send_failures_summary(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_send_failures_by_code(text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_signature_send_failure(uuid, uuid, uuid, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_failure_retried(uuid, uuid) TO authenticated;

-- 코멘트
COMMENT ON TABLE public.signature_send_failures IS
  '서명 발송(initial/reminder/bulk_initial) 실패 로그. admin/owner 조회·재시도 표기, 직원 INSERT 허용(RPC 권장).';
COMMENT ON COLUMN public.signature_send_failures.send_type IS 'initial|reminder|bulk_initial';
COMMENT ON COLUMN public.signature_send_failures.retried IS '재발송 성공 시 true (mark_failure_retried 호출)';
