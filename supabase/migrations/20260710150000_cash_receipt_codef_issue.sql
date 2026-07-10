-- 현금영수증 CODEF 실발행 (2026-07-10)
--   cashbill-issue 엣지가 CODEF /a/cash-bill/regist-issue 로 국세청 실발행.
--   document_key  : 팝빌 발행 문서번호 (발행취소/발행정보 조회에 필수 — 필수 관리)
--   nts_state_code: 팝빌 상태코드 (300 발행완료 / 301~303 전송전 / 304 전송완료 / 305 전송실패 / 400 취소)
--   issue_response: 발행/조회 원문 응답 (진단용)
--   source CHECK 에 'codef' 추가 (CHECK 함정 방지 — notifications 교훈)
ALTER TABLE cash_receipts
  ADD COLUMN IF NOT EXISTS document_key text,
  ADD COLUMN IF NOT EXISTS nts_state_code text,
  ADD COLUMN IF NOT EXISTS issue_response jsonb;

ALTER TABLE cash_receipts DROP CONSTRAINT IF EXISTS cash_receipts_source_check;
ALTER TABLE cash_receipts ADD CONSTRAINT cash_receipts_source_check
  CHECK (source = ANY (ARRAY['manual'::text, 'hometax_sync'::text, 'pos'::text, 'codef'::text]));
