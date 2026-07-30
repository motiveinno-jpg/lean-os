-- 단체일괄 외부 서명 후 회사 패널 회수 흐름 통합.
--   signature_requests 에 quote_approvals 와 같은 4개 컬럼 + 발송 시점 본문 스냅샷 추가.
--   모두 nullable·멱등 ADD COLUMN IF NOT EXISTS — 기존 행 영향 0.

ALTER TABLE public.signature_requests
  ADD COLUMN IF NOT EXISTS signature_method text,
  ADD COLUMN IF NOT EXISTS signature_data_url text,
  ADD COLUMN IF NOT EXISTS signed_contract_html text,
  ADD COLUMN IF NOT EXISTS signed_contract_url text,
  ADD COLUMN IF NOT EXISTS template_snapshot_html text;

COMMENT ON COLUMN public.signature_requests.template_snapshot_html IS
  '단체일괄 발송 시점 변수 치환된 본문 HTML 스냅샷. /sign 외부 페이지 + /contracts/signed 본문 표시 + signed_contract_html 합성 input.';
COMMENT ON COLUMN public.signature_requests.signed_contract_html IS
  '거래처 서명 후 합성된 양측 최종 계약서 HTML (template_snapshot_html + 서명 이미지).';
COMMENT ON COLUMN public.signature_requests.signature_data_url IS
  '거래처 서명 이미지 data URL (base64). signed_contract_html 합성 input.';
COMMENT ON COLUMN public.signature_requests.signature_method IS
  '서명 방식: draw / type / upload / seal.';
