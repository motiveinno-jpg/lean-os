-- 홈택스(국세청) 전자세금계산서 발행 결과 추적용 컬럼.
-- 현재 issueTaxInvoice 는 tax_invoices.status 만 'issued' 마킹할 뿐
-- 실제 CODEF/홈택스 전자발행 호출 결과(승인번호/오류/raw payload)를 저장할 자리가 없었음.
-- hometax-issue edge function 이 발행 시 이 컬럼들을 채움.

ALTER TABLE public.tax_invoices
  -- 발행 워크플로 상태: draft(미발행) | pending(발행 요청 보냄, 대기) | issued(승인 완료) | failed(거절/오류) | cancelled
  -- tax_invoices.status 와 별도. status 는 비즈니스 의미(draft/issued/matched/void/modified) 보존,
  -- nts_issue_status 는 외부 발행 채널 상태만 추적.
  ADD COLUMN IF NOT EXISTS nts_issue_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS nts_error_code   text,
  ADD COLUMN IF NOT EXISTS nts_error_message text,
  ADD COLUMN IF NOT EXISTS nts_request_payload  jsonb,  -- CODEF 로 보낸 raw body (디버깅/감사용)
  ADD COLUMN IF NOT EXISTS nts_response_payload jsonb,  -- CODEF response raw (승인번호/관리번호 등 포함)
  ADD COLUMN IF NOT EXISTS nts_issued_at        timestamptz,  -- 실제 홈택스 발행 승인 시각
  ADD COLUMN IF NOT EXISTS item_name            text;          -- 발행 시 품목명. 현재 label 컬럼은 deal_number 용으로 점유됨.

-- 발행 상태별 빠른 조회 (process-invoice-queue 스캔용)
CREATE INDEX IF NOT EXISTS tax_invoices_nts_issue_status_idx
  ON public.tax_invoices(nts_issue_status)
  WHERE nts_issue_status IN ('pending', 'failed');

COMMENT ON COLUMN public.tax_invoices.nts_issue_status IS
  '홈택스 전자발행 상태: draft(미발행) | pending(요청 중) | issued(승인) | failed(거절) | cancelled';
COMMENT ON COLUMN public.tax_invoices.nts_request_payload IS
  'CODEF /v1/kr/public/nt/popbill/taxinvoice/regist 등으로 보낸 raw payload (감사 + 재시도용).';
COMMENT ON COLUMN public.tax_invoices.nts_response_payload IS
  'CODEF response raw — 승인번호(ntsConfirmNum)/접수번호 포함. nts_confirm_no 와 별개로 전체 응답 보관.';
