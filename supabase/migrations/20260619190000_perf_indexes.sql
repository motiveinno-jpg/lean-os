-- 성능: 누락 인덱스 추가 (기능 변경 없음, 읽기 속도만 개선)
-- 근거(pg_stat_statements):
--   card_transactions WHERE company_id=.. AND transaction_date>=..  → 평균 2.4초 (company_id 인덱스 부재 = seq scan)
--   card_transactions WHERE deal_id=..  → 평균 0.68초 (deal_id 인덱스 부재) — 프로젝트 운영 > 비용 구성
--   cash_receipts WHERE deal_id=..  → 비용 구성 동일 패턴 (deal_id 인덱스 부재)

CREATE INDEX IF NOT EXISTS idx_card_tx_company_date
  ON public.card_transactions (company_id, transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_card_tx_deal
  ON public.card_transactions (deal_id) WHERE deal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cash_receipts_deal
  ON public.cash_receipts (deal_id) WHERE deal_id IS NOT NULL;

ANALYZE public.card_transactions;
ANALYZE public.cash_receipts;
