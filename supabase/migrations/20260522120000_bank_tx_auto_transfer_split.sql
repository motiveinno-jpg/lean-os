-- 2026-05-22 자동이체 ≠ 고정비 분리 (사장님 요청).
--   기존 단일 컬럼 is_fixed_cost 가 자동이체(결제 방식)·고정비(비용 성격)를 혼용 → 독립 2개로 분리.
--   is_auto_transfer 신규(결제 방식), is_fixed_cost 는 고정비(비용 성격)로 의미 정리·유지.
--
-- 데이터 마이그레이션(보존적): 기존 UI '자동' 체크박스가 is_fixed_cost 를 토글해 왔으므로
--   체크된 건(13건)은 자동이체 의도가 다수 → is_auto_transfer=true 로 복사(양쪽 true 보존).
--   is_fixed_cost 는 그대로 둠(고정비로도 의미 있을 수 있음). 멱등.

-- nullable(DEFAULT 없음) — 기존 is_fixed_cost 와 동일 패턴.
--   NULL = 미설정(자동인식 후보), false = 사용자 명시 해제(보존), true = 자동이체.
ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS is_auto_transfer boolean;

UPDATE bank_transactions
   SET is_auto_transfer = true
 WHERE is_fixed_cost = true
   AND is_auto_transfer IS DISTINCT FROM true;

COMMENT ON COLUMN bank_transactions.is_auto_transfer IS
  '자동이체 여부(결제 방식). 고정비(is_fixed_cost, 비용 성격)와 독립. 2026-05-22 분리.';
COMMENT ON COLUMN bank_transactions.is_fixed_cost IS
  '고정비 여부(비용 성격 — 매달 일정하게 나가는 비용). 자동이체(is_auto_transfer, 결제 방식)와 독립.';
