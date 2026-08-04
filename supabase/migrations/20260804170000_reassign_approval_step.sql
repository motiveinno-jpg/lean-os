-- Migration: reassign_approval_step
-- 결재 요청이 올라간 뒤에도 승인자를 바꿀 수 있게 한다 (2026-08-04).
--   approval_steps 의 UPDATE 정책은 "해당 단계의 승인자 본인"만 허용이라
--   마스터/전체현황 권한자가 남의 단계 승인자를 바꿀 수 없다.
--   RLS 를 느슨하게 푸는 대신 SECURITY DEFINER RPC 에 검증 게이트를 두고 통과시킨다.
--
--   가드: 같은 회사 + (마스터 or /approvals:all) + 미처리(pending) 단계 + 같은 회사 비파트너 구성원.

CREATE OR REPLACE FUNCTION public.reassign_approval_step(
  p_step_id uuid,
  p_new_approver_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_step approval_steps%ROWTYPE;
  v_req  approval_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_step FROM approval_steps WHERE id = p_step_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '결재 단계를 찾을 수 없습니다' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM approval_requests WHERE id = v_step.request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '결재 요청을 찾을 수 없습니다' USING ERRCODE = '42501';
  END IF;

  -- 회사 격리
  IF v_req.company_id IS DISTINCT FROM public.get_my_company_id() THEN
    RAISE EXCEPTION '다른 회사의 결재는 변경할 수 없습니다' USING ERRCODE = '42501';
  END IF;

  -- 호출자 권한: 마스터 또는 결재 전체 현황 권한
  IF NOT (public.is_company_admin() OR public.has_perm('/approvals:all')) THEN
    RAISE EXCEPTION '승인자 변경 권한이 없습니다 (마스터 또는 전체 현황 권한 필요)' USING ERRCODE = '42501';
  END IF;

  -- 이미 결재된 단계/요청은 변경 불가
  IF v_step.status IS DISTINCT FROM 'pending' OR v_req.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION '이미 처리된 단계는 승인자를 변경할 수 없습니다' USING ERRCODE = '42501';
  END IF;

  -- 새 승인자는 같은 회사의 비파트너 구성원이어야 한다
  IF NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = p_new_approver_id
      AND u.company_id = v_req.company_id
      AND coalesce(u.role, '') <> 'partner'
  ) THEN
    RAISE EXCEPTION '같은 회사 구성원만 승인자로 지정할 수 있습니다' USING ERRCODE = '42501';
  END IF;

  UPDATE approval_steps
  SET approver_id = p_new_approver_id
  WHERE id = p_step_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.reassign_approval_step(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reassign_approval_step(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.reassign_approval_step(uuid, uuid) TO authenticated;
