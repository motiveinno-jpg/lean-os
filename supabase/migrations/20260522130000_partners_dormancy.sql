-- 2026-05-22 거래처 휴면 감지(④) — partners 에 휴면 플래그 추가.
--   휴면 = 최근 6개월 거래(deals)·세금계산서·소통(partner_communications) 모두 없음.
--   감지 로직은 lib/automation.ts detectDormantPartners (deals 휴면 패턴 미러). RLS 무변경.

ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS is_dormant boolean DEFAULT false;
ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS dormancy_detected_at timestamptz;

COMMENT ON COLUMN partners.is_dormant IS '휴면 거래처 여부 — 최근 6개월 거래·소통 없음. detectDormantPartners 가 갱신.';
