-- Slack webhook URL — 회사별 알림 전송 채널
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS slack_webhook_url text,
  ADD COLUMN IF NOT EXISTS slack_notify_payment boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS slack_notify_approval boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS slack_notify_large_tx boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS slack_large_tx_threshold numeric NOT NULL DEFAULT 1000000;

COMMENT ON COLUMN public.company_settings.slack_webhook_url IS
  'Slack Incoming Webhook URL — Granter 패턴. 결제/결재/큰 거래 발생 시 자동 알림.';
