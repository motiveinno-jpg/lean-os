--   전국 공휴일 자동 수집 크론 — holidays-sync 엣지를 해마다 1월 2일 03:20(KST 12:20)에 부른다.
--   공공데이터포털 특일정보로 올해-1~올해+2 년을 받아 national_holidays 캐시를 갱신한다.
--   HOLIDAY_API_KEY 시크릿이 없으면 엣지가 아무것도 안 하고 skipped 로 응답한다(안전).

select cron.schedule(
  'holidays-sync-yearly',
  '20 3 2 1 *',
  $$
  select net.http_post(
    url := 'https://njbvdkuvtdtkxyylwngn.supabase.co/functions/v1/holidays-sync',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','6958d1db106824dd7251457c00e1c531f848dc6f918738b9a6922a1cedbb8e96'),
    body := '{}'::jsonb
  );
  $$
);
