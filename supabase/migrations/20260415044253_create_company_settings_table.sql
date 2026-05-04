-- Migration: create_company_settings_table
-- Version: 20260415044253
-- Source: production schema_migrations (auto-extracted 2026-05-04)


-- Helper trigger function
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Company settings for external service credentials
CREATE TABLE IF NOT EXISTS company_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  codef_client_id text,
  codef_client_secret text,
  codef_connected_id text,
  codef_connected_at timestamptz,
  hometax_user_id text,
  hometax_password text,
  settings jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(company_id)
);

ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_settings_access" ON company_settings
  FOR ALL USING (company_id = get_my_company_id());

CREATE TRIGGER update_company_settings_ts
  BEFORE UPDATE ON company_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_company_settings_company_id ON company_settings(company_id);
