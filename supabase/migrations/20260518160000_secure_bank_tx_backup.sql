-- Migration: bank_transactions_backup_20260518 격리 (public → internal 스키마 이전)
-- 사유:
--   - public.bank_transactions_backup_20260518 가 RLS 미설정 상태로 노출되어 있음
--   - Supabase advisor: rls_disabled_in_public ERROR
--   - 본 테이블은 20260518 codef-sync 중복정리(20260518130000_bank_tx_dedup.sql)
--     과정에서 1회성으로 만들어진 운영 백업 (15,430건). 서비스 코드 참조 0.
-- 조치 (B안):
--   - internal 스키마로 이전 → public PostgREST 노출 자체 차단
--   - service_role / superuser 만 접근 가능 (백업 콘솔 작업용)
--   - 데이터는 그대로 보존 (DROP/TRUNCATE 금지)
-- 롤백:
--   ALTER TABLE internal.bank_transactions_backup_20260518 SET SCHEMA public;

-- 1) internal 스키마 보장
CREATE SCHEMA IF NOT EXISTS internal;

-- 2) anon/authenticated 가 internal 스키마에 접근하지 못하도록 권한 회수
--    (PostgREST 노출 차단 + 일반 클라이언트 차단)
REVOKE ALL ON SCHEMA internal FROM PUBLIC;
REVOKE ALL ON SCHEMA internal FROM anon;
REVOKE ALL ON SCHEMA internal FROM authenticated;

-- 3) 테이블 이전 (public → internal). 데이터는 그대로 유지됨.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename = 'bank_transactions_backup_20260518'
  ) THEN
    EXECUTE 'ALTER TABLE public.bank_transactions_backup_20260518 SET SCHEMA internal';
  END IF;
END
$$;

-- 4) 만약 이미 internal 에 있다면 권한만 재정비 (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'internal'
      AND tablename = 'bank_transactions_backup_20260518'
  ) THEN
    -- anon/authenticated 직접 접근 차단 (스키마 권한으로 이미 차단되지만 명시)
    EXECUTE 'REVOKE ALL ON TABLE internal.bank_transactions_backup_20260518 FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON TABLE internal.bank_transactions_backup_20260518 FROM anon';
    EXECUTE 'REVOKE ALL ON TABLE internal.bank_transactions_backup_20260518 FROM authenticated';

    -- 명시적으로 RLS 도 켜둠 (이중 방어)
    EXECUTE 'ALTER TABLE internal.bank_transactions_backup_20260518 ENABLE ROW LEVEL SECURITY';

    -- 모든 사용자에게 정책 없음 = 기본 deny.
    -- service_role 은 RLS 우회하므로 콘솔에서 정상 접근.
    -- 기존 정책이 우연히 남아있다면 제거 (idempotent)
    EXECUTE 'DROP POLICY IF EXISTS bank_tx_backup_select ON internal.bank_transactions_backup_20260518';
    EXECUTE 'DROP POLICY IF EXISTS bank_tx_backup_insert ON internal.bank_transactions_backup_20260518';
    EXECUTE 'DROP POLICY IF EXISTS bank_tx_backup_update ON internal.bank_transactions_backup_20260518';
    EXECUTE 'DROP POLICY IF EXISTS bank_tx_backup_delete ON internal.bank_transactions_backup_20260518';
  END IF;
END
$$;

COMMENT ON SCHEMA internal IS '운영용 비공개 스키마. PostgREST 미노출. service_role/superuser 한정.';
