-- ═══════════════════════════════════════════════════════════════════════
-- card_transactions backfill — 카드 식별자 미확인 거래의 card_name 재계산
-- ═══════════════════════════════════════════════════════════════════════
--
-- 배경:
--   codef-sync edge function 이전 버전에서 ch.resUsedCard / billCardNo 가
--   비어있는 거래는 card_name 이 카드사명만 ("BC카드", "롯데카드") 으로 저장됨.
--   같은 카드사 여러 카드의 거래가 한 묶음으로 통합되는 문제.
--
-- 픽스:
--   1. codef-sync 의 폴백 체인 강화 (다음 sync 부터 자동 적용).
--   2. 이미 저장된 row 들에 대해 raw_data 안의 다른 카드 식별 필드로 backfill.
--
-- 실행 방법 (Supabase Dashboard → SQL Editor):
--   - DRY RUN 먼저: 1번 SELECT 로 영향받을 row 수 + 변경될 card_name 미리보기.
--   - 적용: 2번 UPDATE 실행. 트랜잭션으로 감싸 롤백 가능하게.
--
-- 안전장치:
--   - WHERE 조건이 "끝번호 없는 미식별 row" 만 타겟. 정상 식별된 row 는 건드리지 않음.
--   - raw_data 안에 카드 식별자가 실제로 있을 때만 업데이트 (없으면 그대로 둠).
-- ═══════════════════════════════════════════════════════════════════════


-- ── [1] DRY RUN — 영향 범위 미리보기 ──────────────────────────────────────
-- 영향받을 row 수 + 새로 부여될 card_name 샘플 확인.
SELECT
  card_name AS old_card_name,
  raw_data->>'issuer' AS issuer,
  COALESCE(
    NULLIF(REGEXP_REPLACE(COALESCE(raw_data->>'cardIdentifier', ''), '[^0-9]', '', 'g'), ''),
    NULLIF(REGEXP_REPLACE(COALESCE(raw_data->>'cardNo', ''), '[^0-9]', '', 'g'), ''),
    NULLIF(REGEXP_REPLACE(COALESCE(raw_data->>'cardIdResolved', ''), '[^0-9]', '', 'g'), ''),
    NULLIF(REGEXP_REPLACE(COALESCE(raw_data->'bill_meta'->>'resCardNo', ''), '[^0-9]', '', 'g'), ''),
    NULLIF(REGEXP_REPLACE(COALESCE(raw_data->'bill_meta'->>'resOurCardNo', ''), '[^0-9]', '', 'g'), '')
  ) AS recovered_digits,
  RIGHT(
    COALESCE(
      NULLIF(REGEXP_REPLACE(COALESCE(raw_data->>'cardIdentifier', ''), '[^0-9]', '', 'g'), ''),
      NULLIF(REGEXP_REPLACE(COALESCE(raw_data->>'cardNo', ''), '[^0-9]', '', 'g'), ''),
      NULLIF(REGEXP_REPLACE(COALESCE(raw_data->>'cardIdResolved', ''), '[^0-9]', '', 'g'), ''),
      NULLIF(REGEXP_REPLACE(COALESCE(raw_data->'bill_meta'->>'resCardNo', ''), '[^0-9]', '', 'g'), ''),
      NULLIF(REGEXP_REPLACE(COALESCE(raw_data->'bill_meta'->>'resOurCardNo', ''), '[^0-9]', '', 'g'), ''),
      ''
    ),
    4
  ) AS new_last4,
  COUNT(*) AS rows_affected,
  SUM(amount) AS total_amount
FROM card_transactions
WHERE source = 'codef_card'
  AND card_name !~ '\s\d{4}\s*$'              -- 현재 끝에 숫자4자리 없음 = 미식별
  AND card_name = raw_data->>'issuer'         -- card_name 이 카드사명 그대로
  AND (
    NULLIF(REGEXP_REPLACE(COALESCE(raw_data->>'cardIdentifier', ''), '[^0-9]', '', 'g'), '') IS NOT NULL
    OR NULLIF(REGEXP_REPLACE(COALESCE(raw_data->>'cardNo', ''), '[^0-9]', '', 'g'), '') IS NOT NULL
    OR NULLIF(REGEXP_REPLACE(COALESCE(raw_data->>'cardIdResolved', ''), '[^0-9]', '', 'g'), '') IS NOT NULL
    OR NULLIF(REGEXP_REPLACE(COALESCE(raw_data->'bill_meta'->>'resCardNo', ''), '[^0-9]', '', 'g'), '') IS NOT NULL
    OR NULLIF(REGEXP_REPLACE(COALESCE(raw_data->'bill_meta'->>'resOurCardNo', ''), '[^0-9]', '', 'g'), '') IS NOT NULL
  )
GROUP BY 1, 2, 3, 4
ORDER BY rows_affected DESC;


-- ── [2] APPLY — 실제 업데이트 (트랜잭션으로 감쌈) ──────────────────────
-- 위 1번 결과 확인 후 의도와 맞으면 실행.
BEGIN;

UPDATE card_transactions
SET card_name = raw_data->>'issuer' || ' ' || RIGHT(
  COALESCE(
    NULLIF(REGEXP_REPLACE(COALESCE(raw_data->>'cardIdentifier', ''), '[^0-9]', '', 'g'), ''),
    NULLIF(REGEXP_REPLACE(COALESCE(raw_data->>'cardNo', ''), '[^0-9]', '', 'g'), ''),
    NULLIF(REGEXP_REPLACE(COALESCE(raw_data->>'cardIdResolved', ''), '[^0-9]', '', 'g'), ''),
    NULLIF(REGEXP_REPLACE(COALESCE(raw_data->'bill_meta'->>'resCardNo', ''), '[^0-9]', '', 'g'), ''),
    NULLIF(REGEXP_REPLACE(COALESCE(raw_data->'bill_meta'->>'resOurCardNo', ''), '[^0-9]', '', 'g'), '')
  ),
  4
)
WHERE source = 'codef_card'
  AND card_name !~ '\s\d{4}\s*$'
  AND card_name = raw_data->>'issuer'
  AND (
    NULLIF(REGEXP_REPLACE(COALESCE(raw_data->>'cardIdentifier', ''), '[^0-9]', '', 'g'), '') IS NOT NULL
    OR NULLIF(REGEXP_REPLACE(COALESCE(raw_data->>'cardNo', ''), '[^0-9]', '', 'g'), '') IS NOT NULL
    OR NULLIF(REGEXP_REPLACE(COALESCE(raw_data->>'cardIdResolved', ''), '[^0-9]', '', 'g'), '') IS NOT NULL
    OR NULLIF(REGEXP_REPLACE(COALESCE(raw_data->'bill_meta'->>'resCardNo', ''), '[^0-9]', '', 'g'), '') IS NOT NULL
    OR NULLIF(REGEXP_REPLACE(COALESCE(raw_data->'bill_meta'->>'resOurCardNo', ''), '[^0-9]', '', 'g'), '') IS NOT NULL
  );

-- 변경 row 수 확인
-- 원하지 않으면: ROLLBACK;
COMMIT;


-- ═══════════════════════════════════════════════════════════════════════
-- ── [3] 사후 검증 — backfill 후 남은 미식별 거래 확인 ─────────────────────
-- 이 결과에 남는 row 들은 raw_data 자체에 카드 식별자가 없는 거래.
-- → 다음 sync (edge function 신규 버전) 후 raw_data 가 더 풍부해지면 다시 1번-2번 실행.
SELECT
  raw_data->>'issuer' AS issuer,
  COUNT(*) AS still_unidentified_count,
  SUM(amount) AS total_amount,
  MIN(transaction_date) AS oldest_tx,
  MAX(transaction_date) AS newest_tx
FROM card_transactions
WHERE source = 'codef_card'
  AND card_name !~ '\s\d{4}\s*$'
  AND card_name = raw_data->>'issuer'
GROUP BY 1
ORDER BY still_unidentified_count DESC;
