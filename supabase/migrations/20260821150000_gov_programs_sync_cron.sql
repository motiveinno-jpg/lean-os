-- 지원사업 공고 매일 수집 (2026-08-21)
--
-- 새벽 5시(KST)에 K-Startup 진행 중 공고를 받아 gov_programs 를 갱신한다.
--   · 하루 1회면 충분하다 — 공고는 하루 단위로 뜨고 내려간다. 자주 부를수록 원천 API 에 부담만 된다.
--   · 함수 안에 30분 쿨타임이 있어 사람이 겹쳐 불러도 두 번 받지 않는다.
--   · 실패해도 조용히 넘어가지 않는다 — gov_sync_log 에 ok=false 와 사유가 남는다.
--
-- ⚠️ 이 크론이 성공하려면 Supabase 시크릿 **DATA_GO_KR_KSTARTUP_KEY** 가 있어야 한다.
--    기존 DATA_GO_KR_API_KEY(사업자등록 상태조회)와 **다른 계정 키다 — 덮어쓰지 말 것.**
--
-- 되돌리기: select cron.unschedule('gov-programs-sync-daily');

select cron.schedule(
  'gov-programs-sync-daily',
  '0 20 * * *',          -- UTC 20:00 = KST 05:00
  $$
  select net.http_post(
    url := 'https://njbvdkuvtdtkxyylwngn.supabase.co/functions/v1/gov-programs-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      --   공개 anon 키다(브라우저 번들에 이미 실려 나가는 값) — 시크릿이 아니다.
      --   기존 크론(ads-sync-daily·toss-charge-daily 등)과 같은 방식.
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qYnZka3V2dGR0a3h5eWx3bmduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MjQyMDIsImV4cCI6MjA4ODEwMDIwMn0.Tcbxj-SP5814QEiaTBMi5SRjmB-ExRYV_b0zt_m9Kho'
    ),
    body := '{}'::jsonb
  );
  $$
);
