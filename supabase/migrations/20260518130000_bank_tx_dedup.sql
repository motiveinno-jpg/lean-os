-- Migration: bank_transactions 중복 방지 (external_id + unique index)
-- 원인: codef-sync 가 통장 거래를 plain insert 해서 재동기화마다 중복 적재
--       (15,430건 중 10,366건 중복). 잔액 불일치·합계 부풀림 유발.
-- 조치:
--   1) 중복 정리는 운영에서 1회 수행 (백업 테이블 bank_transactions_backup_20260518 보존)
--   2) external_id 결정적 키 + 부분 유니크 인덱스 → 이후 upsert(onConflict)

ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS external_id text;

-- 기존 codef_bank 행 백필 (codef-sync 가 만드는 키와 동일 규칙)
UPDATE bank_transactions
SET external_id = concat_ws('|',
  company_id::text,
  raw_data->>'accountNo',
  to_char(transaction_date,'YYYYMMDD'),
  coalesce(raw_data->>'trTime',''),
  amount::text,
  type,
  balance_after::text,
  coalesce(counterparty,'')
)
WHERE external_id IS NULL AND source = 'codef_bank';

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_tx_external
  ON bank_transactions(external_id) WHERE external_id IS NOT NULL;
