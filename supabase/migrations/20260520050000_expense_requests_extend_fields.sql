-- =====================================================================
-- U2 지출결의서 8필드 확장 (멱등)
-- =====================================================================
-- 직원 원문: "전자결재 지출결의서 상세내용에 사유/기안일/결제요청일/상세내역/
--           총금액(부가세유무)/결제방법/비고/첨부파일 이렇게 넣어줘요"
--
-- 매핑:
--   사유 → reason
--   기안일 → request_date (default created_at::date)
--   결제요청일 → payment_due_date
--   상세내역 → detail_items jsonb (line items: [{desc, qty, price, ...}])
--   총금액(부가세유무) → has_vat boolean + vat_amount (계산값; amount 컬럼 재사용)
--   결제방법 → payment_method (card|bank|cash|other)
--   비고 → note
--   첨부파일 → 기존 receipt_urls (TEXT[]) 재사용 (커밋 4346f0a 패턴, company-assets bucket)
--
-- 비파괴: ADD COLUMN IF NOT EXISTS, 기본값으로 기존 행 무영향.
-- RLS 무수정: 기존 회사격리·본인격리 정책이 새 컬럼에도 자동 적용.
-- =====================================================================

ALTER TABLE public.expense_requests
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS request_date date,
  ADD COLUMN IF NOT EXISTS payment_due_date date,
  ADD COLUMN IF NOT EXISTS detail_items jsonb,
  ADD COLUMN IF NOT EXISTS has_vat boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS vat_amount numeric(15,2),
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS note text;

COMMENT ON COLUMN public.expense_requests.reason            IS 'U2: 지출 사유';
COMMENT ON COLUMN public.expense_requests.request_date      IS 'U2: 기안일 (작성일). 미지정 시 created_at::date 사용 권장.';
COMMENT ON COLUMN public.expense_requests.payment_due_date  IS 'U2: 결제 요청일';
COMMENT ON COLUMN public.expense_requests.detail_items      IS 'U2: 상세내역 JSON (line items: [{desc, qty, price, ...}])';
COMMENT ON COLUMN public.expense_requests.has_vat           IS 'U2: 부가세 유무. true 면 vat_amount 산정 (보통 round(amount*0.1)).';
COMMENT ON COLUMN public.expense_requests.vat_amount        IS 'U2: 부가세액 (수기 또는 클라이언트 계산 저장).';
COMMENT ON COLUMN public.expense_requests.payment_method    IS 'U2: 결제방법 (card|bank|cash|other).';
COMMENT ON COLUMN public.expense_requests.note              IS 'U2: 비고.';
