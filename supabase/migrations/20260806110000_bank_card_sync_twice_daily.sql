-- 은행·카드 자동 동기화를 하루 2회로 확정 (2026-08-06 요금제 개편)
--   기존 2시간 주기(월 360사이클)면 계좌당 3,600원/월 — 19,000원 요금제를 통째로 먹는다.
--   하루 2회(월 60사이클) = 계좌당 600원/월. 이 값이 요금제 원가 계산의 전제다.
--   09:10 / 18:10 KST = 00:10 / 09:10 UTC (pg_cron 은 UTC).
DO $$
DECLARE v_bank bigint; v_card bigint;
BEGIN
  SELECT jobid INTO v_bank FROM cron.job WHERE jobname = 'bank-sync-tick';
  SELECT jobid INTO v_card FROM cron.job WHERE jobname = 'card-sync-tick';
  IF v_bank IS NULL OR v_card IS NULL THEN
    RAISE EXCEPTION 'bank/card sync cron 을 찾을 수 없습니다 (bank=%, card=%)', v_bank, v_card;
  END IF;
  PERFORM cron.alter_job(job_id := v_bank, schedule := '10 0,9 * * *');
  PERFORM cron.alter_job(job_id := v_card, schedule := '40 0,9 * * *');
END $$;
