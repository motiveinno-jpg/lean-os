-- 통장·카드 CODEF 자동 동기화 주기 변경: 하루 2회 → 2시간마다 (2026-08-04 사장님 지시)
--   bank-sync-tick: '0 1,13 * * *'(KST 10·22시) → '0 */2 * * *' (짝수 시 정각, UTC 기준)
--   card-sync-tick: '0 4,16 * * *'(KST 13·01시) → '30 */2 * * *' (짝수 시 30분)
--   30분 오프셋: 두 동기화의 CODEF 호출이 같은 순간에 겹치지 않게 (레이트리밋·엣지 부하 분산).
--   command(호출 본문)는 그대로 두고 schedule 만 alter_job 으로 변경 — 멱등.
DO $$
DECLARE
  v_bank int;
  v_card int;
BEGIN
  SELECT jobid INTO v_bank FROM cron.job WHERE jobname = 'bank-sync-tick';
  SELECT jobid INTO v_card FROM cron.job WHERE jobname = 'card-sync-tick';
  IF v_bank IS NULL OR v_card IS NULL THEN
    RAISE EXCEPTION 'bank/card sync cron 을 찾을 수 없습니다 (bank=%, card=%)', v_bank, v_card;
  END IF;
  PERFORM cron.alter_job(job_id := v_bank, schedule := '0 */2 * * *');
  PERFORM cron.alter_job(job_id := v_card, schedule := '30 */2 * * *');
  RAISE NOTICE 'bank-sync-tick → 0 */2 * * *, card-sync-tick → 30 */2 * * * 변경 완료';
END $$;
