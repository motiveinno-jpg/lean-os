-- AI 브리핑 아침 자동 생성 cron (2026-07-10) — 매일 08:00 KST(23:00 UTC)
--   ai-briefing 엣지 cron 모드 호출: 활성 회사(최근 30일 매출 계산서 보유)별로 오늘 브리핑을
--   선생성해 캐시하고, 대표(owner)에게 알림 insert → notifications 트리거가 웹푸시 자동 발송.
--   ⚠️ x-brief-secret 실제 값은 prod 에 적용됨(엣지 시크릿 BRIEF_CRON_SECRET 와 동일) — 이 파일엔
--      플레이스홀더. 재적용 시 <BRIEF_CRON_SECRET> 치환.
--   cron 가드: 단일 http_post 1회/일 — 락 경합·슬롯 고갈 위험 없음(과거 cron 인시던트 교훈 준수).
select cron.schedule(
  'ai-briefing-morning',
  '0 23 * * *',
  $$
  select net.http_post(
    url := 'https://njbvdkuvtdtkxyylwngn.supabase.co/functions/v1/ai-briefing',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-brief-secret', '<BRIEF_CRON_SECRET>'),
    body := '{}'::jsonb
  );
  $$
);
