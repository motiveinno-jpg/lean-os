-- Migration: bank_tx_external_unique_full
-- Version: 20260519090000  (최신 20260519080000 이후)
--
-- L티어 · 운영버그 핵심수정 — 은행 거래 ingestion 전면 정지의 진짜 원인 제거.
--
-- ── 확정 근본원인 (라이브 스모크로 입증) ─────────────────────────────────────
--   codef-sync `syncBankTransactions` (supabase/functions/codef-sync/index.ts:421-433)
--   가 다음과 같이 upsert:
--       .upsert({ ...external_id... },
--               { onConflict: "external_id", ignoreDuplicates: true })
--   → 생성되는 SQL 은 bare arbiter:  ON CONFLICT (external_id) DO NOTHING.
--
--   그런데 dedup 마이그레이션 20260518130000_bank_tx_dedup.sql 이 만든 인덱스는
--   **부분(partial) 유니크**:
--       CREATE UNIQUE INDEX uq_bank_tx_external
--         ON bank_transactions(external_id) WHERE external_id IS NOT NULL;
--
--   Postgres 의 ON CONFLICT 추론 규칙(문서: "Inference and Partial Indexes"):
--   bare `ON CONFLICT (col)` 는 column/expression 리스트만으로 arbiter 인덱스를
--   추론하며, **부분 인덱스는 ON CONFLICT 절에 그 인덱스의 predicate 가
--   포함될 때만** arbiter 후보가 된다. bare arbiter 에는 predicate 가 없으므로
--   `WHERE external_id IS NOT NULL` 부분 인덱스는 추론에서 제외된다.
--   → 매칭되는 유니크/배제 제약이 없어 모든 codef_bank insert 가
--     'there is no unique or exclusion constraint matching the
--      ON CONFLICT specification' (SQLSTATE 42P10) 으로 실패.
--   → syncBankTransactions 의 synced=0, 2026-05-18 dedup 적용 이래 은행 거래
--     적재 전면 정지 (5/14 이후 미적재의 진짜 원인).
--   스모크 증거: CODEF listLen=25(운영계좌 99002393104017)/2 정상 응답이나
--                insertErrors=25/2 전건 실패.
--
-- ── prod 사실 (적용 전 읽기 확인 완료) ──────────────────────────────────────
--   · bank_transactions total = 5064
--   · external_id 보유 = 5064,  external_id IS NULL = 0건
--   · 중복 external_id = 0건 (dup_external_ids=0)
--   → 전체(non-partial) 유니크 인덱스 생성 시 제약 위반 0 보장.
--
-- ── 조치 ────────────────────────────────────────────────────────────────────
--   부분 유니크 인덱스를 **predicate 없는 전체 유니크 인덱스**로 교체.
--   · 전체 유니크 인덱스는 bare `ON CONFLICT (external_id)` arbiter 로
--     정상 추론된다(부분 인덱스 불가의 정반대) → upsert 즉시 복구.
--   · Postgres 의 유니크 인덱스 NULL 처리 기본값은 "NULLS DISTINCT"
--     (각 NULL 은 서로 구별됨). 따라서 전체 유니크라도 external_id IS NULL
--     인 행은 **여러 건 계속 허용**된다(수동입력 거래 등). dedup 의미 불변 —
--     codef 거래는 결정적 external_id 를 가지므로 여전히 1건만 유지.
--
-- ── 무영향 / 회귀 0 ─────────────────────────────────────────────────────────
--   · 데이터 변경 없음. 인덱스 DDL 만 (UPDATE/DELETE/TRUNCATE 전무).
--   · e39b351 잔액 산식, external_id 생성 규칙(codef-sync L417-419), dedup 키
--     의미, recompute_bank_balances(20260519080000) — 전부 무변경.
--   · 5064행 소형 테이블 → 비-CONCURRENT 생성 sub-second.
--     lock_timeout 으로 락 대기 상한, statement_timeout 으로 전체 상한.
--     CONCURRENT 미사용: 트랜잭션/Supabase Management API(apply_migration)
--     호환을 우선(CONCURRENT 는 트랜잭션 블록 내 실행 불가).
--   · 홈택스/현금영수증/카드 인덱스·로직 미접촉.
--
-- 멱등: DROP INDEX IF EXISTS 후 CREATE UNIQUE INDEX IF NOT EXISTS.

SET lock_timeout = '4000';
SET statement_timeout = '20000';

-- 1) 부분 유니크 인덱스 제거 (ON CONFLICT arbiter 로 추론 불가했던 그것).
DROP INDEX IF EXISTS public.uq_bank_tx_external;

-- 2) predicate 없는 전체 유니크 인덱스 재생성 (동명 재사용).
--    · bare ON CONFLICT (external_id) arbiter 로 정상 매칭 → upsert 복구.
--    · NULLS DISTINCT 기본 → external_id NULL 다건 계속 허용 (수동입력 무영향).
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_tx_external
  ON public.bank_transactions (external_id);

COMMENT ON INDEX public.uq_bank_tx_external IS
  'codef-sync upsert(onConflict:external_id) 의 ON CONFLICT (external_id) '
  'arbiter 와 매칭되는 전체 유니크 인덱스. 20260518130000 의 부분 인덱스는 '
  'bare arbiter 추론 불가(SQLSTATE 42P10)라 전체로 교체. NULLS DISTINCT '
  '기본 → external_id NULL 수동입력 거래는 다건 허용. 데이터 변경 없음.';

-- =============================================================================
-- 롤백 (참고 — 별도 실행, 비권장)
-- =============================================================================
--   ⚠️ 롤백은 기능 회귀다. 아래로 되돌리면 bare ON CONFLICT (external_id) 가
--      다시 부분 인덱스를 arbiter 로 추론하지 못해 codef_bank 거래 upsert 가
--      재차 전건 실패(SQLSTATE 42P10) → 은행 거래 적재가 다시 정지된다.
--      롤백이 정말 필요하면 codef-sync 의 upsert 도 함께 되돌려야 한다.
--
--   SET lock_timeout = '4000';
--   SET statement_timeout = '20000';
--   DROP INDEX IF EXISTS public.uq_bank_tx_external;
--   CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_tx_external
--     ON public.bank_transactions(external_id) WHERE external_id IS NOT NULL;
