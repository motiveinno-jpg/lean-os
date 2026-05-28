-- 2026-05-28 외부 서명 페이지(/sign, anon) — 본문 라디오/조건부 텍스트 입력값을
-- signature_requests.signer_inputs jsonb 컬럼에 저장하는 SECURITY DEFINER RPC.
-- 기존 submit_signature_by_token 의 시그니처는 변경하지 않고 별도 RPC 로 분리 —
--   1) 시그니처 호환 보장 (옛 클라이언트 영향 0)
--   2) signer_inputs 가 없는 서식은 호출 자체 생략 가능
-- 호출 순서: submit_signature_by_token(서명 저장) → save_signer_inputs_by_token(입력값 저장)
--   둘 다 sign_token 검증 후 동작 (token = secret).

CREATE OR REPLACE FUNCTION public.save_signer_inputs_by_token(
  p_token text,
  p_inputs jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_token IS NULL OR length(p_token) < 8 THEN
    RAISE EXCEPTION '유효하지 않은 토큰' USING ERRCODE = '22023';
  END IF;
  IF p_inputs IS NULL THEN
    -- null 은 그냥 컬럼 그대로 둠 (변경 없음).
    RETURN jsonb_build_object('ok', true, 'noop', true);
  END IF;

  SELECT id INTO v_id
  FROM signature_requests WHERE sign_token = p_token LIMIT 1;

  IF v_id IS NULL THEN
    RAISE EXCEPTION '서명 요청을 찾을 수 없습니다' USING ERRCODE = 'P0002';
  END IF;

  UPDATE signature_requests
  SET signer_inputs = p_inputs
  WHERE id = v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.save_signer_inputs_by_token(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_signer_inputs_by_token(text, jsonb) TO anon, authenticated;

COMMENT ON FUNCTION public.save_signer_inputs_by_token(text, jsonb) IS
  '외부 서명 페이지용 — sign_token 검증 후 signer_inputs(jsonb) 저장 (anon 허용, token secret).';

NOTIFY pgrst, 'reload schema';
