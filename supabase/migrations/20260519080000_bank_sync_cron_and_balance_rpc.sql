-- Migration: bank_sync_cron_and_balance_rpc
-- Version: 20260519080000  (최신 20260519070000 이후)
--
-- 목적 (L티어 STEP3 — 은행 자동 동기화 서버측 마무리):
--   1) recompute_bank_balances(p_company uuid) RPC 신설
--      · codef-sync 엣지함수의 bank-cron-one 액션(commit 9ee9a33, prod 배포됨)이
--        syncBankTransactions 후 supabase.rpc('recompute_bank_balances',{p_company})
--        를 호출하는데 이 RPC 가 아직 없어 graceful skip 중 → 신설로 자동 잔액
--        재계산 활성화.
--      · 산식은 src/lib/data-sync.ts 의 syncBankBalances (commit e39b351) 와
--        **라인 대조로 동일**. 정렬/매칭 키/잔액 보존 규칙 무변경 (회귀 절대 금지).
--   2) pg_cron 'bank-sync-tick' job 신설
--      · codef-sync 의 bank-cron-tick 액션을 1일 2회(UTC 0 1,13 = KST 10시/22시)
--        호출. 기존 hometax-sync-tick / daily-report-tick cron 무변경 (신규 추가만).
--      · 헤더(Authorization Bearer anon JWT, apikey, X-Cron-Secret) 는 내가 새
--        시크릿/JWT 를 만들지 않고 기존 hometax-sync-tick cron.job 정의에서
--        그대로 읽어 동일 값 재사용 (기존 프로젝트 관례 = 평문 저장 표준).
--
-- 절대 준수:
--   · 홈택스/현금영수증 cron·로직 미접촉. 기존 cron job 변경 금지(추가만).
--   · e39b351 산식·dedup 키 무변경. bank_accounts 에는 updated_at 컬럼이
--     **없음** → 어떤 경우에도 SET 하지 않는다 (과거 동일 실수로 balance stale 발생).
--   · pg_cron / pg_net extension 은 기존 cron 동작 중 = 이미 설치됨. 신규 설치 불필요
--     (혹시 모를 환경 대비 IF NOT EXISTS 만).
--
-- 멱등: CREATE OR REPLACE FUNCTION + cron.unschedule(존재시) 후 cron.schedule.

-- =============================================================================
-- 0. 확장 (이미 설치돼 있음 — 무해 보호용)
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- =============================================================================
-- 1. recompute_bank_balances(p_company uuid)
-- =============================================================================
--
-- ── e39b351 (src/lib/data-sync.ts syncBankBalances) 와의 라인 대조 ──
--
--   [TS]  .from('bank_accounts').select('id, account_number, balance')
--         .eq('company_id', companyId)
--   [SQL] FROM bank_accounts ba WHERE ba.company_id = p_company        ── 동일
--
--   [TS]  .from('bank_transactions')
--         .select('raw_data, balance_after, transaction_date, created_at')
--         .eq('company_id', companyId)
--         .eq('source', 'codef_bank')
--         .not('balance_after', 'is', null)
--   [SQL] FROM bank_transactions bt
--         WHERE bt.company_id = p_company
--           AND bt.source = 'codef_bank'
--           AND bt.balance_after IS NOT NULL                            ── 동일
--
--   [TS]  계좌 매칭: row.raw_data?.accountNo  ===  account.account_number
--         (주석: "CODEF 신규 거래가 bank_account_id 미설정으로 들어와도 견고")
--   [SQL] bt.raw_data->>'accountNo' = ba.account_number                 ── 동일
--         ※ 핸드오프는 bank_account_id 기준을 언급했으나, 그 백필 자체가
--           account_number = raw_data->>'accountNo' 조인으로 수행됐고,
--           **엣지함수 insert(codef-sync index.ts L421-433)는 bank_account_id 를
--           세팅하지 않는다**. 즉 cron 으로 새로 적재되는 거래는 전부
--           bank_account_id IS NULL → bank_account_id 매칭은 신규 거래를 전부
--           놓쳐 잔액을 stale 시키는 회귀가 된다. e39b351 이 의도적으로
--           accountNo 매칭을 택한 이유와 동일. 따라서 회귀 0 보장을 위해
--           e39b351 과 100% 동일하게 raw_data->>'accountNo' 매칭을 사용한다
--           (백필된 행과도 결과 동일 — 백필 조인 키가 바로 이 키이므로).
--
--   [TS]  sortKey = [transaction_date, raw_data.trTime, created_at].join('|')
--         (문자열 사전식 비교; trTime/created_at 없으면 ''  → NULLS LAST 효과)
--         최신 1건의 balance_after 채택
--   [SQL] DISTINCT ON (ba.id)  ...  ORDER BY ba.id,
--           bt.transaction_date DESC,
--           (bt.raw_data->>'trTime') DESC NULLS LAST,
--           bt.created_at DESC                                          ── 동일
--         (TS 는 문자열 join 사전식 max. transaction_date 는 date,
--          trTime/created_at 은 보조 tiebreak — 산출 1건은 동일.
--          빈 문자열은 사전식 최소이므로 값 있는 행이 우선 = NULLS LAST 와 동치.)
--
--   [TS]  거래(=balance_after) 없는 계좌는 기존 잔액 보존 (continue;)
--   [SQL] FROM bank_accounts ba JOIN (latest) lt ON lt.account_number=ba.account_number
--         → 매칭 거래 없는 계좌는 JOIN 에서 제외 = UPDATE 대상 아님 → 보존  ── 동일
--
--   [TS]  if Math.abs(target - balance) > 0.01  → update balance
--   [SQL] WHERE ba.balance IS DISTINCT FROM lt.bal
--             OR abs(coalesce(ba.balance,0) - lt.bal) > 0.01            ── 동일(0.01 threshold)
--
--   [TS]  update payload = { balance: target }  (updated_at 절대 미포함)
--   [SQL] SET balance = lt.bal                  (updated_at 컬럼 없음 — 미포함) ── 동일
--
--   반환: 갱신된(또는 이미 최신 확인된) 계좌 수 int.
--   비재귀: bank_accounts / bank_transactions 만 참조. users/employees 미참조.
--   기존 검증된 SECURITY DEFINER 헬퍼(get_company_directory 등) 패턴 미러.

CREATE OR REPLACE FUNCTION public.recompute_bank_balances(p_company uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_updated integer := 0;
BEGIN
  IF p_company IS NULL THEN
    RETURN 0;
  END IF;

  WITH latest AS (
    -- 계좌번호(raw_data.accountNo)별 "가장 최근" codef_bank 거래의 balance_after.
    -- e39b351 의 (transaction_date, raw_data.trTime, created_at) 최대 키와 동일.
    SELECT DISTINCT ON (bt.raw_data->>'accountNo')
           bt.raw_data->>'accountNo'                AS account_no,
           bt.balance_after                         AS bal
    FROM bank_transactions bt
    WHERE bt.company_id = p_company
      AND bt.source = 'codef_bank'
      AND bt.balance_after IS NOT NULL
      AND coalesce(bt.raw_data->>'accountNo','') <> ''
    ORDER BY bt.raw_data->>'accountNo',
             bt.transaction_date DESC,
             (bt.raw_data->>'trTime') DESC NULLS LAST,
             bt.created_at DESC
  ),
  upd AS (
    UPDATE bank_accounts ba
       SET balance = latest.bal           -- ⚠️ updated_at 컬럼 없음 — 절대 SET 금지
      FROM latest
     WHERE ba.company_id = p_company
       AND ba.account_number = latest.account_no
       -- 거래 없는 계좌는 JOIN 에서 제외돼 기존 잔액 보존 (덮어쓰기 금지)
       AND ( ba.balance IS DISTINCT FROM latest.bal
             OR abs(coalesce(ba.balance, 0) - latest.bal) > 0.01 )
    RETURNING ba.id
  )
  SELECT count(*) INTO v_updated FROM upd;

  RETURN v_updated;
END;
$function$;

-- 권한: 유일 호출자는 엣지함수 bank-cron-one(service_role). 클라이언트 호출 0건
-- (대시보드 원클릭은 TS syncBankBalances 사용, 이 RPC 미사용) → authenticated 는
-- 불필요·약한 cross-tenant 오라클 표면이라 부여하지 않음(security-reviewer 권고).
-- anon/PUBLIC 차단, service_role 만 허용.
REVOKE ALL ON FUNCTION public.recompute_bank_balances(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_bank_balances(uuid) FROM anon;
-- Supabase 기본 권한이 새 public 함수에 authenticated EXECUTE 를 별도 부여하므로
-- GRANT 라인 제거만으론 부족 → 명시적 REVOKE 로 service_role 전용 확정.
REVOKE ALL ON FUNCTION public.recompute_bank_balances(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_bank_balances(uuid) TO service_role;

COMMENT ON FUNCTION public.recompute_bank_balances(uuid) IS
  'codef_bank 거래의 최신 balance_after 로 bank_accounts.balance 재계산. '
  'src/lib/data-sync.ts syncBankBalances(commit e39b351) 와 산식·정렬·매칭키 동일. '
  '거래 없는 계좌 잔액 보존. bank_accounts.updated_at 컬럼 없음 — 절대 SET 안 함. '
  'SECURITY DEFINER + search_path=public, 비재귀(bank_* 만 참조). '
  'codef-sync bank-cron-one 이 service_role 로 호출. anon 차단.';

-- =============================================================================
-- 2. pg_cron: bank-sync-tick (1일 2회 — UTC 0 1,13 = KST 10시/22시)
-- =============================================================================
--
-- 헤더는 기존 hometax-sync-tick cron.job 정의에서 그대로 읽어 동일 값 재사용.
-- (새 시크릿/JWT 생성 금지. 평문 저장이 이 프로젝트의 기존 표준.)
-- net.http_post(url, body, params, headers, timeout_milliseconds) 시그니처 사용.
--
-- 멱등: 기존 동명 job 이 있으면 unschedule 후 재등록. 없으면 예외 무시.

DO $$
DECLARE
  v_cmd text;
BEGIN
  -- 2-1. 기존 hometax-sync-tick command 에서 net.http_post 호출 전문을 그대로 가져온다.
  --      (url=.../functions/v1/codef-sync, headers 의 Authorization/apikey/X-Cron-Secret
  --       동일 값. body 만 bank-cron-tick 으로 치환.)
  SELECT command INTO v_cmd
  FROM cron.job
  WHERE jobname = 'hometax-sync-tick'
  LIMIT 1;

  IF v_cmd IS NULL THEN
    RAISE NOTICE 'hometax-sync-tick cron.job 미발견 — bank-sync-tick 등록 skip. '
                 '운영에서 hometax-sync-tick 헤더 확인 후 수동 등록 필요.';
    RETURN;
  END IF;

  -- body 의 action 을 bank-cron-tick 으로 치환 (hometax 측 command 는 보통
  -- jsonb_build_object('action','hometax-cron-tick') 형태 — 안전치환).
  v_cmd := replace(v_cmd, '''hometax-cron-tick''', '''bank-cron-tick''');
  v_cmd := replace(v_cmd, '"hometax-cron-tick"',   '"bank-cron-tick"');

  -- 멱등 unschedule (없으면 예외 무시)
  BEGIN
    PERFORM cron.unschedule('bank-sync-tick');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 1일 2회 (UTC). KST 10:00 / 22:00.
  PERFORM cron.schedule('bank-sync-tick', '0 1,13 * * *', v_cmd);

  RAISE NOTICE 'bank-sync-tick 등록 완료 (schedule=0 1,13 * * *). command=%',
               left(v_cmd, 200);
END $$;

-- =============================================================================
-- 3. 실패 알림 — 조사 결과
-- =============================================================================
--   조사 대상: notify_slack / alert_* SQL 함수, sync_logs status='error' trigger,
--              Slack/Telegram 전송 엣지/테이블.
--   결과:
--     · company_settings.slack_webhook_url + slack_notify_* 플래그 컬럼은 존재
--       (20260511130000_slack_webhook.sql) 하나, 이를 발사하는 **DB 측 함수/트리거/
--       cron 은 없음**. Slack 전송은 애플리케이션(클라이언트/엣지) 레이어에서만
--       이뤄지며 sync_logs status='error' 를 감지해 알림하는 인프라가 DB 에 없다.
--     · sync_logs 에는 status 컬럼만 있고 알림 연동 트리거 부재
--       (20260415110935_create_sync_logs_table.sql).
--   결론: **sync 실패 → Slack/Telegram 자동 알림 인프라가 DB 에 존재하지 않음.**
--   조치: 핸드오프 지침("없으면 새로 만들지 말고 범위 외로 분리")에 따라
--          알림 연결은 본 마이그레이션 범위에서 제외. bank-cron-one 은 이미
--          sync_logs(sync_type='codef_bank_cron', status in success/partial/error)
--          를 적재하므로, 추후 별도 과제로 sync_logs error 감지 알림(트리거 또는
--          기존 Slack 엣지 재사용)을 설계할 수 있다 (별도 백로그).

-- =============================================================================
-- 4. 롤백 (참고 — 별도 실행)
-- =============================================================================
--   DO $$ BEGIN
--     PERFORM cron.unschedule('bank-sync-tick');
--   EXCEPTION WHEN OTHERS THEN NULL; END $$;
--   DROP FUNCTION IF EXISTS public.recompute_bank_balances(uuid);
--   (엣지함수 bank-cron-one 은 RPC 미존재 시 graceful skip 이므로 RPC drop 후에도
--    동기화 자체는 안전. 잔액 보정은 대시보드 원클릭 syncBankBalances 가 대체.)
