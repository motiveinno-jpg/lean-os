-- signature_requests: add signer_inputs jsonb column
-- 서명자가 본문 내 라디오/텍스트 토큰(fieldKey)에 입력한 값을 보관.
-- shape: { "<fieldKey>": "<value>", ... }
--   예) { "포기사유": "기타", "기타사유": "현재 사업 종료 예정" }
-- key = 토큰 fieldKey (문자열), value = 사용자 입력 문자열 또는 라디오 선택 라벨.
-- 단일 컬럼 추가만. RLS / publication / 헬퍼 무변경.

ALTER TABLE public.signature_requests
  ADD COLUMN IF NOT EXISTS signer_inputs jsonb NULL;

COMMENT ON COLUMN public.signature_requests.signer_inputs IS
  '서명자 입력값(본문 토큰 응답). shape: { "<fieldKey>": "<value>", ... } e.g. { "포기사유": "기타", "기타사유": "현재 사업 종료 예정" }';
