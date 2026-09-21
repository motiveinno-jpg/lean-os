-- company_settings 의 Slack 알림 칸 5개 삭제 (2026-09-21)
--
-- History
--   2026-05-11 20260511130000_slack_webhook.sql 이 "결제/결재/큰 거래 발생 시 Slack 자동 알림" 을 만들려고
--   slack_webhook_url + slack_notify_* 3개 + slack_large_tx_threshold 를 더했다.
--   그 뒤 발사하는 쪽(엣지·트리거·cron·화면)은 한 번도 만들어지지 않았다
--   (2026-05-19 bank_sync_cron 주석 · 2026-08-21 credential_warnings 주석 · 2026-09-17 백로그 실측 모두 같은 결론).
--
-- 실측(2026-09-21 prod)
--   company_settings 5행 · slack_webhook_url 값 0행 · 플래그 4개 전부 기본값 그대로.
--   이 칸을 읽거나 쓰는 함수·뷰·정책·트리거 0개(pg_proc/pg_views/pg_policies/pg_trigger 검색).
--   앱 코드 0곳(src 전체 grep — types/database.ts 와 api-keys.ts 의 "일부러 뺐다" 주석뿐).
--
-- 왜 지우나
--   설정 화면에는 이미 안 그린다(api-keys.ts:191 — 동작 안 하는 줄을 그리면 "연결하면 되겠지" 로 믿게 만든다).
--   남은 위험은 칸 자체다: 웹훅 주소는 그 자체가 발송 권한이라 평문으로 들어오면 안 되는데,
--   칸이 있으면 언젠가 누가 넣는다. 값이 0행인 지금이 지우기 가장 쉬운 때다.
--
-- 버린 안
--   · Slack 알림 구현 — 알림 채널은 telegram-notify(엣지)·카카오 알림톡(검수 대기)이 이미 자리하고 있고
--     Slack 수요 근거가 0. 필요해지면 company_api_keys(암호화)에 웹훅을 넣고 새로 설계한다 — 이 평문 칸을 살릴 이유가 없다.
--   · 주석으로만 못 박기(2026-08-21 방식) — 이미 했고, 그래도 칸은 남는다.

alter table public.company_settings
  drop column if exists slack_webhook_url,
  drop column if exists slack_notify_payment,
  drop column if exists slack_notify_approval,
  drop column if exists slack_notify_large_tx,
  drop column if exists slack_large_tx_threshold;
