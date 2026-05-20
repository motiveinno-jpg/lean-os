-- quote_approvals — 견적·계약·진행·완료·정산 단계별 외부 승인 워크플로우.
--   외부(거래처) 가 토큰 링크로 접근 → 승인/거절 결정 → RPC 가 deals.stage 자동 전환.
--   견적 발송→승인 흐름을 시작으로, 계약/진행/완료/정산 단계는 같은 테이블의
--   stage 분기로 재사용 (테이블 추가 없이 일반화).
--
-- 비재귀 RLS (feedback_rls_recursion_gate):
--   정책 본문 인라인 `FROM users|employees` 0건. 기존 SECURITY DEFINER 헬퍼만 사용
--   (get_my_company_id / is_company_admin / current_app_user_id — 모두 SET search_path=public).
--
-- 신규 SECURITY DEFINER 헬퍼 0. 비즈니스 RPC 4종(+ 토큰 생성 1) 만 추가.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────
-- 1) 테이블
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quote_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('estimate','contract','progress_report','completion','settlement')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,  -- 발송 시점 스냅샷
  approval_token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','viewed','approved','rejected','expired')),
  recipient_email text,
  recipient_name text,
  partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  sent_at timestamptz,
  viewed_at timestamptz,
  decided_at timestamptz,
  expires_at timestamptz,
  decision_note text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quote_approvals_company_deal_stage
  ON public.quote_approvals (company_id, deal_id, stage);
CREATE INDEX IF NOT EXISTS idx_quote_approvals_status_expires
  ON public.quote_approvals (status, expires_at);
-- approval_token UNIQUE 가 이미 인덱스를 만들기에 별도 idx 생략.

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION public.quote_approvals_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS quote_approvals_touch ON public.quote_approvals;
CREATE TRIGGER quote_approvals_touch
  BEFORE UPDATE ON public.quote_approvals
  FOR EACH ROW EXECUTE FUNCTION public.quote_approvals_touch();

ALTER TABLE public.quote_approvals ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) RLS — 비재귀 (SECURITY DEFINER 헬퍼만, 인라인 users/employees 서브쿼리 0)
-- ─────────────────────────────────────────────────────────────────────────

-- 2a) PERMISSIVE 회사격리 (회사 멤버만 본인 회사 행 보임).
DROP POLICY IF EXISTS quote_approvals_company ON public.quote_approvals;
CREATE POLICY quote_approvals_company ON public.quote_approvals
  FOR ALL TO authenticated
  USING (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());

-- 2b) RESTRICTIVE SELECT — admin 또는 본인이 만든 행만.
DROP POLICY IF EXISTS quote_approvals_select_admin_or_self ON public.quote_approvals;
CREATE POLICY quote_approvals_select_admin_or_self ON public.quote_approvals
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (is_company_admin() OR created_by = current_app_user_id());

-- 2c) RESTRICTIVE INSERT — admin 또는 본인 created_by 만.
DROP POLICY IF EXISTS quote_approvals_insert_admin_or_self ON public.quote_approvals;
CREATE POLICY quote_approvals_insert_admin_or_self ON public.quote_approvals
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (is_company_admin() OR created_by = current_app_user_id());

-- 2d) UPDATE — admin only. 외부 결정은 SECURITY DEFINER RPC 경유.
DROP POLICY IF EXISTS quote_approvals_update_admin ON public.quote_approvals;
CREATE POLICY quote_approvals_update_admin ON public.quote_approvals
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (is_company_admin())
  WITH CHECK (is_company_admin());

-- 2e) DELETE — admin only.
DROP POLICY IF EXISTS quote_approvals_delete_admin ON public.quote_approvals;
CREATE POLICY quote_approvals_delete_admin ON public.quote_approvals
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (is_company_admin());

-- ─────────────────────────────────────────────────────────────────────────
-- 3) RPC — generate_approval_token (256bit 엔트로피, url-safe base64)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_approval_token()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RETURN replace(replace(replace(encode(gen_random_bytes(32), 'base64'), '/', '_'), '+', '-'), '=', '');
END;
$$;
REVOKE ALL ON FUNCTION public.generate_approval_token() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_approval_token() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) RPC — get_quote_approval_by_token (외부 anon 접근, 토큰 검증)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_quote_approval_by_token(p_token text)
RETURNS TABLE(
  id uuid,
  stage text,
  status text,
  payload jsonb,
  recipient_name text,
  recipient_email text,
  sent_at timestamptz,
  expires_at timestamptz,
  decided_at timestamptz,
  decision_note text,
  deal_id uuid,
  deal_name text,
  contract_total numeric,
  company_name text,
  company_representative text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_row record;
  v_effective_status text;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN
    RETURN; -- 빈 결과 (invalid token)
  END IF;

  SELECT qa.id, qa.stage, qa.status, qa.payload, qa.recipient_name, qa.recipient_email,
         qa.sent_at, qa.expires_at, qa.decided_at, qa.decision_note, qa.deal_id,
         d.name AS deal_name, d.contract_total,
         c.name AS company_name, c.representative AS company_representative
    INTO v_row
    FROM quote_approvals qa
    JOIN deals d ON d.id = qa.deal_id
    JOIN companies c ON c.id = qa.company_id
    WHERE qa.approval_token = p_token
    LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- 만료 자동 표시 (DB 행 변이 X — 별도 RPC/cron 에서 status='expired' 로 영구화)
  v_effective_status := v_row.status;
  IF v_row.status IN ('draft','sent','viewed') AND v_row.expires_at IS NOT NULL AND v_row.expires_at < now() THEN
    v_effective_status := 'expired';
  END IF;

  id := v_row.id;
  stage := v_row.stage;
  status := v_effective_status;
  payload := v_row.payload;
  recipient_name := v_row.recipient_name;
  recipient_email := v_row.recipient_email;
  sent_at := v_row.sent_at;
  expires_at := v_row.expires_at;
  decided_at := v_row.decided_at;
  decision_note := v_row.decision_note;
  deal_id := v_row.deal_id;
  deal_name := v_row.deal_name;
  contract_total := v_row.contract_total;
  company_name := v_row.company_name;
  company_representative := v_row.company_representative;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.get_quote_approval_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_quote_approval_by_token(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) RPC — mark_quote_approval_viewed (idempotent)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_quote_approval_viewed(p_token text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN
    RETURN false;
  END IF;
  UPDATE quote_approvals
     SET status = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END,
         viewed_at = COALESCE(viewed_at, now())
   WHERE approval_token = p_token
     AND status IN ('sent','viewed')
     AND (expires_at IS NULL OR expires_at >= now())
   RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_quote_approval_viewed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_quote_approval_viewed(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) RPC — submit_quote_decision (외부 결정 + deals.stage 자동 전환)
--    audit_logs: 라이브 스키마는 (action, entity_type, entity_id, user_id, metadata, company_id)
--    notifications: type CHECK enum 에 'approval' 포함 확인 (20260312064244).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_quote_decision(
  p_token text,
  p_decision text,
  p_note text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_row quote_approvals%ROWTYPE;
  v_next_stage text;
  v_company_id uuid;
BEGIN
  IF p_decision NOT IN ('approved','rejected') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid');
  END IF;
  IF p_token IS NULL OR length(p_token) < 16 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid');
  END IF;

  SELECT * INTO v_row FROM quote_approvals WHERE approval_token = p_token LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid');
  END IF;

  IF v_row.status IN ('approved','rejected') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_decided', 'status', v_row.status);
  END IF;
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'expired');
  END IF;

  -- 결정 기록
  UPDATE quote_approvals
     SET status = p_decision,
         decided_at = now(),
         decision_note = p_note
   WHERE id = v_row.id;

  v_company_id := v_row.company_id;

  -- 승인 → deals.stage 자동 전환
  IF p_decision = 'approved' THEN
    v_next_stage := CASE v_row.stage
      WHEN 'estimate'         THEN 'contract'
      WHEN 'contract'         THEN 'in_progress'
      WHEN 'progress_report'  THEN 'completed'
      WHEN 'completion'       THEN 'settlement'
      WHEN 'settlement'       THEN NULL  -- 변경 없음
      ELSE NULL
    END;
    IF v_next_stage IS NOT NULL THEN
      UPDATE deals SET stage = v_next_stage WHERE id = v_row.deal_id;
    END IF;
  END IF;

  -- audit_logs (테이블 또는 컬럼 미존재 시 방어적 무시)
  BEGIN
    INSERT INTO audit_logs(company_id, action, entity_type, entity_id, user_id, metadata)
    VALUES (
      v_company_id,
      CASE p_decision WHEN 'approved' THEN 'approve' ELSE 'reject' END,
      'quote_approval',
      v_row.id,
      NULL,  -- 외부 결정 (anon)
      jsonb_build_object('stage', v_row.stage, 'next_stage', v_next_stage, 'note', p_note)
    );
  EXCEPTION
    WHEN undefined_table THEN NULL;
    WHEN undefined_column THEN NULL;
  END;

  -- 회사 owner/admin 에게 notifications (CHECK enum 'approval')
  BEGIN
    INSERT INTO notifications(company_id, user_id, type, title, message, entity_type, entity_id, is_read)
    SELECT v_company_id,
           u.id,
           'approval',
           CASE p_decision
             WHEN 'approved' THEN '거래처 승인 — ' || v_row.stage
             ELSE '거래처 거절 — ' || v_row.stage
           END,
           COALESCE(p_note, ''),
           'quote_approval',
           v_row.id,
           false
      FROM users u
     WHERE u.company_id = v_company_id
       AND u.role IN ('owner','admin');
  EXCEPTION
    WHEN undefined_table THEN NULL;
    WHEN check_violation THEN NULL;  -- CHECK enum 변경 시 안전 fallback
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'status', p_decision,
    'deal_stage_after', v_next_stage,
    'stage', v_row.stage
  );
END;
$$;
REVOKE ALL ON FUNCTION public.submit_quote_decision(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_quote_decision(text, text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) RPC — resend_quote_approval (기존 행 보존 + 새 토큰)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resend_quote_approval(
  p_prev_id uuid,
  p_payload jsonb DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_prev quote_approvals%ROWTYPE;
  v_new_id uuid;
  v_uid uuid := current_app_user_id();
  v_my_company uuid := get_my_company_id();
BEGIN
  IF v_uid IS NULL OR v_my_company IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  SELECT * INTO v_prev FROM quote_approvals WHERE id = p_prev_id LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not found';
  END IF;
  -- 권한: admin 또는 본인 created_by
  IF NOT (is_company_admin() OR v_prev.created_by = v_uid) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF v_prev.company_id <> v_my_company THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO quote_approvals(
    company_id, deal_id, stage, payload, approval_token, status,
    recipient_email, recipient_name, partner_id, expires_at, created_by
  ) VALUES (
    v_prev.company_id,
    v_prev.deal_id,
    v_prev.stage,
    COALESCE(p_payload, v_prev.payload),
    generate_approval_token(),
    'draft',
    v_prev.recipient_email,
    v_prev.recipient_name,
    v_prev.partner_id,
    NULL,  -- 발송 시점에 채움
    v_uid
  )
  RETURNING id INTO v_new_id;
  RETURN v_new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.resend_quote_approval(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resend_quote_approval(uuid, jsonb) TO authenticated;

COMMENT ON TABLE public.quote_approvals IS
  '견적·계약·진행·완료·정산 단계별 외부 승인 워크플로우. stage 분기로 일반화.';
COMMENT ON FUNCTION public.submit_quote_decision(text, text, text) IS
  '외부 결정 RPC — 승인 시 deals.stage 자동 전환 (estimate→contract→in_progress→completed→settlement).';
