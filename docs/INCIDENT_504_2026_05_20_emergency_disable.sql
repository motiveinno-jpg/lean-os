-- ═══════════════════════════════════════════════════════════════
-- 🚨 응급 비활성화 SQL — 504 인시던트 2026-05-20
-- ═══════════════════════════════════════════════════════════════
-- 사용법:
--   1. Supabase Dashboard → Project Settings → Restart database (사용자 명시 승인 후)
--   2. 재시작 후 Dashboard → SQL Editor 에서 본 파일 내용 paste·실행
--   3. 즉시 health 측정 SQL (맨 아래 #VERIFY) → 회복 확인
--   4. 회복되면 lessons.md 정합 (범인 명시) + 비재귀·저부하 재설계 마이그 별도 PR
--
-- 안전:
--   - DROP 은 트리거·함수만. 테이블·행 보존. 데이터 손실 0.
--   - 견적 발송 일시 정지 (테이블은 살아있음 — 재배포 시 즉시 복구 가능)
--   - 마이그레이션 자체는 ledger 에서 안 지움 (rollback 아니라 일부 트리거만 무효화)
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ── 1) 가장 최근 + 의심 1순위: quote_approvals 트리거 ──
-- updated_at touch 자체는 가벼우나 cascade 가능. 일시 비활성화.
DROP TRIGGER IF EXISTS quote_approvals_touch ON public.quote_approvals;

-- ── 2) checkIn chain (b7c73a8e) 의심: attendance_records 위 트리거가 있다면 ──
-- 안전망: attendance_records 위 사용자 정의 트리거 전수 식별 + 일시 DROP 후 재현 안 되는지 확인.
--   (Supabase SQL Editor 에서 다음 SELECT 로 확인 후 필요한 것만 DROP)
-- SELECT trigger_name, event_manipulation, action_statement
--   FROM information_schema.triggers
--   WHERE event_object_table='attendance_records' AND trigger_schema='public';

-- ── 3) 다른 창의 allowance 트리거 (의심 2순위) ──
-- DO 블록으로 안전하게 — 존재 시에만 DROP.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tgname, tgrelid::regclass::text AS rel
    FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgrelid::regclass::text IN (
        'public.allowance_entries',
        'public.allowance_types',
        'public.allowance_catalog'
      )
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s', r.tgname, r.rel);
    RAISE NOTICE 'DROPPED: % ON %', r.tgname, r.rel;
  END LOOP;
END $$;

-- ── 4) submit_quote_decision RPC 의 동기 notifications INSERT (의심 3순위) ──
-- RPC 자체는 보존(외부 결정 경로 살려야 함). RPC 안의 notifications INSERT 가
-- cascade 트리거 호출하면 폭증 가능. notifications 위 트리거 진단:
-- SELECT trigger_name FROM information_schema.triggers
--   WHERE event_object_table='notifications' AND trigger_schema='public';

COMMIT;

-- ═══════════════════════════════════════════════════════════════
-- #VERIFY — 회복 확인 (위 BEGIN/COMMIT 끝나고 별도 실행)
-- ═══════════════════════════════════════════════════════════════

-- A. hung 쿼리 (5초+) 0 확인
SELECT count(*) AS hung_5s
FROM pg_stat_activity
WHERE state != 'idle' AND now() - query_start > interval '5 seconds';

-- B. 커넥션 풀 사용량
SELECT
  count(*) AS total,
  count(*) FILTER (WHERE state='active') AS active,
  count(*) FILTER (WHERE state='idle in transaction') AS idle_in_tx,
  count(*) FILTER (WHERE state='idle in transaction (aborted)') AS aborted
FROM pg_stat_activity;

-- C. 재귀 의심 정책 (5/19 패턴) — 0건이어야 함
SELECT polname, polrelid::regclass AS rel
FROM pg_policy
WHERE pg_get_expr(polqual, polrelid) ~ '\mFROM\s+(public\.)?(users|employees)\M'
   OR pg_get_expr(polwithcheck, polrelid) ~ '\mFROM\s+(public\.)?(users|employees)\M';

-- D. 가장 오래된 활성 쿼리 top 10 (어디서 막혔는지)
SELECT pid, state, wait_event_type, wait_event,
       now() - query_start AS dur,
       left(query, 200) AS q
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY query_start ASC
LIMIT 10;

-- E. 최근 마이그 ledger (어느 마이그 직후 시작됐는지)
SELECT version, applied_at
FROM applied_migrations
WHERE applied_at > now() - interval '24 hours'
ORDER BY applied_at DESC;
