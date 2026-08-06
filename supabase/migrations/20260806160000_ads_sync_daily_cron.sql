-- 광고 성과 매일 자동 수집 (2026-08-06 사장님 지시). prod 적용 완료(MCP apply_migration).
--   05:30 KST = 20:30 UTC. 네이버 통계가 하루치로 정리된 뒤에 돈다.
--   함수는 등록된 계정 전부를 돌며 **최근 3일을 다시 덮어쓴다**(광고비 확정이 늦기 때문).
--   ⚠️ 서비스 키를 파일에 적지 않는다 — 이미 도는 bank-sync-tick 의 헤더에서 그대로 읽어 쓴다.
DO $$
DECLARE v_cmd text; v_tok text;
BEGIN
  SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'bank-sync-tick';
  IF v_cmd IS NULL THEN
    RAISE EXCEPTION '기준이 될 bank-sync-tick 작업을 찾을 수 없습니다 — 토큰을 가져올 곳이 없습니다';
  END IF;
  v_tok := (regexp_match(v_cmd, 'Bearer ([A-Za-z0-9._\-]+)'))[1];
  IF v_tok IS NULL THEN
    RAISE EXCEPTION 'bank-sync-tick 에서 토큰을 찾지 못했습니다';
  END IF;

  PERFORM cron.unschedule('ads-sync-daily') FROM cron.job WHERE jobname = 'ads-sync-daily';

  PERFORM cron.schedule('ads-sync-daily', '30 20 * * *', format($f$
  SELECT net.http_post(
    url := 'https://njbvdkuvtdtkxyylwngn.supabase.co/functions/v1/ads-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer %s'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $f$, v_tok));
END $$;
