-- P0 단체 일괄 서명: signature_requests 에 거래처/배치 추적 컬럼 추가.
--   partner_id: 어느 거래처(partners.id) 에 보낸 요청인지 추적. 미가입 단체
--     이므로 user_id 매핑은 불가. ON DELETE SET NULL (거래처 삭제해도 서명
--     이력 보존).
--   batch_id: 같은 일괄 발송 묶음 식별 (UUID, 발송 시점에 lib에서 생성).
--     실패 부분성공 시 batch_id 로 실패행만 재발송 가능.
--   batch_seq: 일괄 내 순번 (정렬·표시용).
-- RLS: signature_requests 의 기존 회사격리 정책 그대로. 새 컬럼은 회사격리
--   범위 안이므로 추가 정책 불필요.

ALTER TABLE public.signature_requests
  ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS batch_seq int;

-- 회사 + 배치로 일괄 조회 (목록·재시도·진행도).
CREATE INDEX IF NOT EXISTS idx_signature_requests_company_batch
  ON public.signature_requests (company_id, batch_id)
  WHERE batch_id IS NOT NULL;

-- 같은 배치 안에서 같은 거래처 중복 발송 방지 (배치당 partner 1회).
--   부분 인덱스(batch_id, partner_id 둘 다 NOT NULL 일 때만) 으로 단건 발송
--   (기존 single-create 경로) 와 충돌 없음.
CREATE UNIQUE INDEX IF NOT EXISTS uq_signature_requests_batch_partner
  ON public.signature_requests (batch_id, partner_id)
  WHERE batch_id IS NOT NULL AND partner_id IS NOT NULL;

COMMENT ON COLUMN public.signature_requests.partner_id IS '대상 거래처(미가입 단체). 단체 일괄 발송 신기능용. 단건 발송에선 NULL.';
COMMENT ON COLUMN public.signature_requests.batch_id IS '일괄 발송 그룹 ID (lib 에서 uuid_generate_v4 로 생성). 단건 발송에선 NULL.';
COMMENT ON COLUMN public.signature_requests.batch_seq IS '일괄 내 순번 (1-base).';
