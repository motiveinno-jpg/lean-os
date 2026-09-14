--   holidays-sync 크론에 게이트웨이 통과용 Authorization 헤더 추가.
--   함수가 verify_jwt=true 라 Supabase 게이트웨이가 Authorization(Bearer) 을 요구한다.
--   x-cron-secret 만 보내면 401(게이트웨이 단계)로 막혀 매년 자동 갱신이 안 됐다.
--   anon Bearer 로 게이트웨이를 통과하고, 함수 안 권한은 x-cron-secret 으로 확인한다.

select cron.unschedule('holidays-sync-yearly') where exists (select 1 from cron.job where jobname='holidays-sync-yearly');

select cron.schedule(
  'holidays-sync-yearly',
  '20 3 2 1 *',
  $$
  select net.http_post(
    url := 'https://njbvdkuvtdtkxyylwngn.supabase.co/functions/v1/holidays-sync',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qYnZka3V2dGR0a3h5eWx3bmduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MjQyMDIsImV4cCI6MjA4ODEwMDIwMn0.Tcbxj-SP5814QEiaTBMi5SRjmB-ExRYV_b0zt_m9Kho',
      'apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qYnZka3V2dGR0a3h5eWx3bmduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MjQyMDIsImV4cCI6MjA4ODEwMDIwMn0.Tcbxj-SP5814QEiaTBMi5SRjmB-ExRYV_b0zt_m9Kho',
      'x-cron-secret','6958d1db106824dd7251457c00e1c531f848dc6f918738b9a6922a1cedbb8e96'
    ),
    body := '{}'::jsonb
  );
  $$
);
