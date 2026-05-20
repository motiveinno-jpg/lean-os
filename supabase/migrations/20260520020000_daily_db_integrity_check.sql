-- Migration: daily_db_integrity_check
-- Version: 20260520020000  (최신 20260519090000 이후)
--
-- 목적 (L티어 · P0-2 — 일일 DB 정합 점검 + 이상 시 텔레그램 알림):
--   2026-05-18~19 인시던트: codef 은행 sync 가 부분 유니크 인덱스 + bare
--   ON CONFLICT 불일치로 적재 전건 실패(synced=0). 클라이언트 화면은 기존 데이터로
--   정상 보였고 sync_logs 에도 흔적이 약해 며칠간 무탐지.
--   → DB 측 일일 자동 점검 + 비-ok 시 CEO 텔레그램으로 즉시 통보하여 재발 차단.
--
-- 본 마이그레이션은 다음 3가지를 추가한다:
--   1) RPC  public.daily_db_integrity_check() → jsonb  (5종 체크, 비-mutating)
--   2) 테이블 public.db_integrity_checks (점검 결과 누적, RLS, write=서비스함수만)
--   3) pg_cron 'daily-db-integrity-tick'  (UTC 매일 00:00 = KST 09:00 영업시작 직전)
--      · 기존 hometax-sync-tick cron.job command 의 헤더 jsonb 를 런타임 추출하여
--        신규 시크릿/JWT 평문 노출 0 (bank-sync-tick 검증 기법 동일).
--      · 결과 row 1건 INSERT 후 severity != 'ok' 면 회사 CEO chat_id 에
--        telegram-notify 엣지함수로 알림. chat_id 미설정 회사는 graceful skip.
--
-- 절대 준수:
--   · 홈택스/현금영수증/은행 cron·로직 미접촉. 기존 cron job 변경 금지(신규만).
--   · e39b351 잔액 산식·external_id dedup 키 무변경. bank_transactions 데이터
--     mutate 0 (점검 전부 read-only — count/exists/pg_catalog).
--   · 함수 본문에 users/employees 인라인 서브쿼리 0 (RLS 재귀 게이트 준수).
--     참조 테이블: pg_indexes, pg_policies, pg_stat_activity, bank_transactions
--     (전부 RLS 재진입 표면 없음).
--   · SECURITY DEFINER + SET search_path = public.
--   · 권한: REVOKE PUBLIC/anon/authenticated, GRANT service_role 만
--     (P0-2 = service_role/cron 호출 전용, 클라이언트가 .rpc() 호출 안 함).
--
-- 멱등: CREATE OR REPLACE FUNCTION + CREATE TABLE IF NOT EXISTS +
--       DROP POLICY IF EXISTS … CREATE POLICY … + cron.unschedule 가드.

SET lock_timeout = '4000';
SET statement_timeout = '20000';

-- =============================================================================
-- 0. 확장 (이미 설치돼 있음 — 무해 보호용)
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- =============================================================================
-- 1. 추적 테이블  public.db_integrity_checks
-- =============================================================================
-- 일일 점검 결과 누적. 추세 분석/회귀 추적/중복 알림 억제(추후)에 사용.
-- write 는 SECURITY DEFINER RPC 만 (RLS 로 service_role 외 INSERT/UPDATE/DELETE 차단).
-- read 는 authenticated (운영 가시성 — payload 에 PII 없음, 메타데이터만).

CREATE TABLE IF NOT EXISTS public.db_integrity_checks (
  id        bigserial    PRIMARY KEY,
  run_at    timestamptz  NOT NULL DEFAULT now(),
  severity  text         NOT NULL CHECK (severity IN ('ok','warn','critical')),
  payload   jsonb        NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_db_integrity_checks_run_at
  ON public.db_integrity_checks (run_at DESC);

ALTER TABLE public.db_integrity_checks ENABLE ROW LEVEL SECURITY;

-- SELECT: authenticated 모두 허용 (운영 모니터링 화면용 — 메타데이터만 노출).
DROP POLICY IF EXISTS "db_integrity_checks_select" ON public.db_integrity_checks;
CREATE POLICY "db_integrity_checks_select"
  ON public.db_integrity_checks
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT/UPDATE/DELETE: 명시 정책 부재 → 기본 deny (service_role 만 BYPASS RLS).
--   SECURITY DEFINER RPC 가 owner=postgres 로 실행 시 RLS 우회되어 INSERT 가능.

COMMENT ON TABLE public.db_integrity_checks IS
  '일일 DB 정합 점검 결과 누적(daily_db_integrity_check RPC 출력). '
  'PII 없음(메타데이터/카운트). write 는 SECURITY DEFINER RPC 만.';

-- =============================================================================
-- 2. RPC  public.daily_db_integrity_check()  → jsonb
-- =============================================================================
-- 5종 체크:
--   (a) critical: 24h codef_bank 적재 0건  (5/18 사고 시그니처)
--   (b) info:    bank_account_id NULL 추세 (값 보고만)
--   (c) critical: uq_bank_tx_external 인덱스 partial(=WHERE 절 포함) (5/18 사고 시그니처 재발)
--   (d) warn:    pg_stat_activity 5초 초과 active 쿼리 count > 0
--   (e) critical: critical 테이블 RLS 정책 본문에 'FROM users'/'FROM employees' 매칭 (P0-5 재귀 시그니처)
--
-- 결과 jsonb 예:
--   { "severity":"critical", "ts":"…", "checks":{
--       "bank_ingest_24h": {"count":0,"severity":"critical"},
--       "bank_account_id_null": {"total":0,"new_24h":0,"severity":"ok"},
--       "uq_bank_tx_external_partial": {"is_partial":false,"severity":"ok"},
--       "hung_queries_5s": {"count":0,"severity":"ok"},
--       "rls_recursion_signature": {"count":0,"severity":"ok"}
--   }}

-- NOTE: VOLATILE (기본) — 본문에서 db_integrity_checks INSERT 하므로 STABLE 불가.
--       (STABLE 함수는 DB 변경 불허 → 호출 시 read-only tx error.)
CREATE OR REPLACE FUNCTION public.daily_db_integrity_check()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ts                  timestamptz := now();
  v_bank_ingest_24h     bigint;
  v_bai_null_total      bigint;
  v_bai_null_new24      bigint;
  v_uq_indexdef         text;
  v_uq_is_partial       boolean;
  v_hung_5s             bigint;
  v_rls_recur_hits      bigint;
  v_severity            text := 'ok';
  v_checks              jsonb := '{}'::jsonb;
  v_result              jsonb;
  v_critical_tables     text[] := ARRAY[
    'users','employees','payslip_overrides',
    'card_transactions','corporate_cards','payroll_items'
  ];
BEGIN
  -- (a) 24h codef_bank 적재 0건 → critical (사고 시그니처).
  SELECT count(*) INTO v_bank_ingest_24h
  FROM public.bank_transactions
  WHERE source = 'codef_bank'
    AND created_at > now() - interval '24 hours';

  v_checks := v_checks || jsonb_build_object(
    'bank_ingest_24h', jsonb_build_object(
      'count',    v_bank_ingest_24h,
      'severity', CASE WHEN v_bank_ingest_24h = 0 THEN 'critical' ELSE 'ok' END
    )
  );
  IF v_bank_ingest_24h = 0 THEN
    v_severity := 'critical';
  END IF;

  -- (b) bank_account_id NULL 추세 (값 보고만 — severity 'ok' 고정, 누적분석은 별도).
  SELECT
    count(*) FILTER (WHERE bank_account_id IS NULL),
    count(*) FILTER (WHERE bank_account_id IS NULL
                      AND created_at > now() - interval '24 hours')
  INTO v_bai_null_total, v_bai_null_new24
  FROM public.bank_transactions;

  v_checks := v_checks || jsonb_build_object(
    'bank_account_id_null', jsonb_build_object(
      'total',    v_bai_null_total,
      'new_24h',  v_bai_null_new24,
      'severity', 'ok'
    )
  );

  -- (c) uq_bank_tx_external 인덱스 partial 여부 (WHERE 절 존재 시 critical = 5/18 재발).
  SELECT indexdef INTO v_uq_indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname  = 'uq_bank_tx_external'
  LIMIT 1;

  -- 인덱스 자체가 없으면 critical (적재 자체가 깨짐).
  IF v_uq_indexdef IS NULL THEN
    v_checks := v_checks || jsonb_build_object(
      'uq_bank_tx_external_partial', jsonb_build_object(
        'is_partial', null,
        'missing',    true,
        'severity',   'critical'
      )
    );
    v_severity := 'critical';
  ELSE
    v_uq_is_partial := (v_uq_indexdef ~* '\s+WHERE\s+');
    v_checks := v_checks || jsonb_build_object(
      'uq_bank_tx_external_partial', jsonb_build_object(
        'is_partial', v_uq_is_partial,
        'indexdef',   v_uq_indexdef,
        'severity',   CASE WHEN v_uq_is_partial THEN 'critical' ELSE 'ok' END
      )
    );
    IF v_uq_is_partial THEN
      v_severity := 'critical';
    END IF;
  END IF;

  -- (d) pg_stat_activity 5초 초과 active 쿼리 count > 0 → warn (critical 격상 안 함).
  SELECT count(*) INTO v_hung_5s
  FROM pg_stat_activity
  WHERE state = 'active'
    AND now() - query_start > interval '5 seconds'
    AND pid <> pg_backend_pid();   -- 본 RPC 자신 제외

  v_checks := v_checks || jsonb_build_object(
    'hung_queries_5s', jsonb_build_object(
      'count',    v_hung_5s,
      'severity', CASE WHEN v_hung_5s > 0 THEN 'warn' ELSE 'ok' END
    )
  );
  IF v_hung_5s > 0 AND v_severity = 'ok' THEN
    v_severity := 'warn';
  END IF;

  -- (e) RLS 재귀 시그니처 — critical 테이블 정책의 qual/with_check 에
  --     'FROM users' 또는 'FROM employees' 인라인 서브쿼리 흔적이 있으면 critical.
  --     SECURITY DEFINER 헬퍼 사용이 우리 표준 → 본문 직접 참조는 재귀 게이트 위반.
  --     (pg_policies 만 조회 — RLS 재진입 표면 없음, 본 함수 자체가 RLS 우회 SECDEF.)
  SELECT count(*) INTO v_rls_recur_hits
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY(v_critical_tables)
    AND (
      coalesce(qual, '')       ~* '\mFROM\s+(public\.)?users\M'
      OR coalesce(qual, '')    ~* '\mFROM\s+(public\.)?employees\M'
      OR coalesce(with_check,'') ~* '\mFROM\s+(public\.)?users\M'
      OR coalesce(with_check,'') ~* '\mFROM\s+(public\.)?employees\M'
    );

  v_checks := v_checks || jsonb_build_object(
    'rls_recursion_signature', jsonb_build_object(
      'count',    v_rls_recur_hits,
      'tables',   to_jsonb(v_critical_tables),
      'severity', CASE WHEN v_rls_recur_hits > 0 THEN 'critical' ELSE 'ok' END
    )
  );
  IF v_rls_recur_hits > 0 THEN
    v_severity := 'critical';
  END IF;

  -- 결과 조립.
  v_result := jsonb_build_object(
    'severity', v_severity,
    'ts',       v_ts,
    'checks',   v_checks
  );

  -- 결과 누적 (RLS 우회 — SECURITY DEFINER).
  INSERT INTO public.db_integrity_checks (run_at, severity, payload)
  VALUES (v_ts, v_severity, v_result);

  RETURN v_result;
END;
$function$;

-- 권한: P0-2 = service_role/cron 호출 전용. 클라이언트 .rpc() 호출 없음.
REVOKE ALL ON FUNCTION public.daily_db_integrity_check() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.daily_db_integrity_check() FROM anon;
REVOKE ALL ON FUNCTION public.daily_db_integrity_check() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.daily_db_integrity_check() TO service_role;

COMMENT ON FUNCTION public.daily_db_integrity_check() IS
  '일일 DB 정합 점검. 5종 체크(24h codef_bank 적재/bank_account_id NULL/'
  'uq_bank_tx_external partial/hung 5s/RLS 재귀 시그니처) 후 jsonb 반환 + '
  'db_integrity_checks 1행 적재. SECURITY DEFINER+search_path=public, '
  'users/employees 인라인 서브쿼리 0 (pg_policies 만 정적 조회). '
  'pg_cron daily-db-integrity-tick 이 service_role 로 호출.';

-- =============================================================================
-- 3. pg_cron: daily-db-integrity-tick (UTC 매일 00:00 = KST 09:00)
-- =============================================================================
-- 헤더는 기존 hometax-sync-tick cron.job 정의에서 그대로 읽어 동일 값 재사용.
-- (새 시크릿/JWT 평문 노출 0 — bank-sync-tick 마이그 검증 기법 동일.)
-- 명령: RPC 실행 → severity != 'ok' 면 회사 CEO chat_id 들에 telegram-notify 호출.
--       chat_id 미설정 회사는 graceful skip.

DO $$
DECLARE
  v_ref_cmd     text;
  v_url         text;
  v_headers     text;   -- ":=jsonb(...)" 직전까지 통째로 추출 (시크릿 평문 미노출)
  v_url_m       text[];
  v_hdr_m       text[];
  v_cmd         text;
BEGIN
  -- 3-1. 기존 hometax-sync-tick command 전문에서 url, headers jsonb 식을 추출.
  SELECT command INTO v_ref_cmd
  FROM cron.job
  WHERE jobname = 'hometax-sync-tick'
  LIMIT 1;

  IF v_ref_cmd IS NULL THEN
    RAISE NOTICE 'hometax-sync-tick cron.job 미발견 — daily-db-integrity-tick 등록 skip. '
                 '운영에서 hometax-sync-tick 헤더 확인 후 수동 등록 필요.';
    RETURN;
  END IF;

  -- url:='https://…/functions/v1/<fn>'  추출
  v_url_m := regexp_match(v_ref_cmd, 'url\s*:=\s*''([^'']+)''');
  IF v_url_m IS NULL OR array_length(v_url_m,1) < 1 THEN
    RAISE NOTICE 'hometax-sync-tick command 에서 url 추출 실패 — skip.';
    RETURN;
  END IF;
  -- url 의 함수명은 codef-sync 일 것이나, telegram-notify 로 치환해 사용.
  v_url := regexp_replace(v_url_m[1], '/functions/v1/[^/?]+', '/functions/v1/telegram-notify');

  -- headers:=jsonb_build_object(…) 또는 headers:='{…}'::jsonb  추출 (jsonb 식 통째로).
  v_hdr_m := regexp_match(v_ref_cmd, 'headers\s*:=\s*(jsonb_build_object\([^)]*\)|''[^'']+''::jsonb)');
  IF v_hdr_m IS NULL OR array_length(v_hdr_m,1) < 1 THEN
    RAISE NOTICE 'hometax-sync-tick command 에서 headers 추출 실패 — skip.';
    RETURN;
  END IF;
  v_headers := v_hdr_m[1];

  -- 3-2. 명령 본문 — RPC 실행 후 severity!=ok 이면 회사별 텔레그램 알림.
  --      DO $cron$ 블록을 cron command 로 들고 다닐 수 있게 인용부호를 두 배로
  --      이스케이프해 동적 텍스트로 조립한다.
  v_cmd := format($cmd$
    DO $cron$
    DECLARE
      r           record;
      v_res       jsonb;
      v_sev       text;
      v_chat      text;
      v_msg       text;
      v_summary   text;
    BEGIN
      SELECT public.daily_db_integrity_check() INTO v_res;
      v_sev := coalesce(v_res->>'severity','ok');

      IF v_sev = 'ok' THEN
        RETURN;
      END IF;

      -- 회사별 CEO chat_id enumerate. 미설정 회사는 graceful skip.
      FOR r IN
        SELECT id AS company_id,
               nullif(automation_settings->>'ceo_telegram_chat_id','') AS chat_id,
               coalesce(name, id::text) AS cname
        FROM public.companies
      LOOP
        v_chat := r.chat_id;
        IF v_chat IS NULL THEN
          CONTINUE;  -- 텔레그램 미설정 → 알림 skip
        END IF;

        -- 어떤 체크가 비-ok 인지 요약.
        SELECT string_agg(
                 format('- %%s: %%s', k, (v->>'severity')),
                 E'\n'
               )
          INTO v_summary
          FROM jsonb_each(v_res->'checks') AS x(k,v)
          WHERE coalesce(v->>'severity','ok') <> 'ok';

        v_msg := format(
          E'[DB 정합 점검 %%s]\n회사: %%s\n시각: %%s\n\n%%s\n\n자세히: db_integrity_checks 최근 행 확인',
          upper(v_sev),
          r.cname,
          to_char(now() AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI'),
          coalesce(v_summary,'(상세 없음)')
        );

        PERFORM net.http_post(
          url     := %L,
          body    := jsonb_build_object('chatId', v_chat, 'message', v_msg),
          headers := %s,
          timeout_milliseconds := 8000
        );
      END LOOP;
    END
    $cron$;
  $cmd$, v_url, v_headers);

  -- 멱등 unschedule (없으면 예외 무시).
  BEGIN
    PERFORM cron.unschedule('daily-db-integrity-tick');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- UTC 매일 00:00  = KST 09:00 (영업시작 직전).
  PERFORM cron.schedule('daily-db-integrity-tick', '0 0 * * *', v_cmd);

  RAISE NOTICE 'daily-db-integrity-tick 등록 완료 (schedule=0 0 * * *).';
END $$;

-- =============================================================================
-- 4. 롤백 (참고 — 별도 실행, 비파괴)
-- =============================================================================
--   DO $$ BEGIN
--     PERFORM cron.unschedule('daily-db-integrity-tick');
--   EXCEPTION WHEN OTHERS THEN NULL; END $$;
--   DROP FUNCTION IF EXISTS public.daily_db_integrity_check();
--   DROP TABLE    IF EXISTS public.db_integrity_checks;
--   -- 위 3개 전부 신규 객체 — 기존 테이블/정책 무영향. 데이터 변경 없음.
