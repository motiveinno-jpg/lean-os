-- 알림 설정 — 자금일보 자동 발송 (카카오 알림톡 + 이메일 fallback)
CREATE TABLE IF NOT EXISTS public.notification_settings (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  daily_report_enabled boolean NOT NULL DEFAULT false,
  daily_report_phones text[] NOT NULL DEFAULT '{}',
  daily_report_emails text[] NOT NULL DEFAULT '{}',
  daily_report_send_hour int NOT NULL DEFAULT 9 CHECK (daily_report_send_hour BETWEEN 0 AND 23),
  last_sent_at timestamptz,
  last_sent_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company can read own notification settings" ON public.notification_settings;
CREATE POLICY "company can read own notification settings"
  ON public.notification_settings FOR SELECT
  USING (company_id = public.get_my_company_id());

DROP POLICY IF EXISTS "company can upsert own notification settings" ON public.notification_settings;
CREATE POLICY "company can upsert own notification settings"
  ON public.notification_settings FOR ALL
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());

CREATE INDEX IF NOT EXISTS notification_settings_active_idx
  ON public.notification_settings(daily_report_enabled, daily_report_send_hour)
  WHERE daily_report_enabled = true;

CREATE OR REPLACE FUNCTION public.set_notification_settings_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notification_settings_updated_at ON public.notification_settings;
CREATE TRIGGER trg_notification_settings_updated_at
  BEFORE UPDATE ON public.notification_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_notification_settings_updated_at();

COMMENT ON TABLE public.notification_settings IS
  '회사별 알림 설정 — 자금일보 자동 발송 대상/방식 (카카오 알림톡 우선, 이메일 fallback).';
