-- Enable pgcrypto for symmetric encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Store the encryption key in a secure app_settings table.
-- This key MUST be changed in production via:
--   UPDATE app_settings SET value = 'your-production-key' WHERE key = 'encryption_key';
-- Ideally, use Supabase Vault (vault.secrets) in production instead.
CREATE TABLE IF NOT EXISTS app_settings (
  key   text PRIMARY KEY,
  value text NOT NULL
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Only service_role can read/write app_settings (no anon/authenticated access)
CREATE POLICY "No public access to app_settings"
  ON app_settings FOR ALL
  USING (false);

-- Insert default encryption key (CHANGE IN PRODUCTION)
INSERT INTO app_settings (key, value)
VALUES ('encryption_key', 'CHANGE_ME_IN_PRODUCTION_' || gen_random_uuid()::text)
ON CONFLICT (key) DO NOTHING;

--------------------------------------------------------------------------------
-- Helper: retrieve encryption key (callable only by postgres / service_role)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _get_encryption_key()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT value FROM app_settings WHERE key = 'encryption_key' LIMIT 1;
$$;

-- Revoke execute from public so anon/authenticated cannot call it directly
REVOKE EXECUTE ON FUNCTION _get_encryption_key() FROM PUBLIC;

--------------------------------------------------------------------------------
-- encrypt_credential(plaintext) → base64-encoded PGP ciphertext
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION encrypt_credential(p_plaintext text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_key text;
BEGIN
  IF p_plaintext IS NULL OR p_plaintext = '' THEN
    RETURN NULL;
  END IF;

  v_key := _get_encryption_key();

  RETURN encode(
    pgp_sym_encrypt(p_plaintext, v_key, 'compress-algo=1, cipher-algo=aes256'),
    'base64'
  );
END;
$$;

--------------------------------------------------------------------------------
-- decrypt_credential(ciphertext) → plaintext
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION decrypt_credential(p_ciphertext text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_key text;
BEGIN
  IF p_ciphertext IS NULL OR p_ciphertext = '' THEN
    RETURN NULL;
  END IF;

  v_key := _get_encryption_key();

  RETURN pgp_sym_decrypt(
    decode(p_ciphertext, 'base64'),
    v_key
  );
END;
$$;

--------------------------------------------------------------------------------
-- encrypt_json_credentials(jsonb) → jsonb with sensitive fields encrypted
-- Encrypts: login_password, cert_password, password
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION encrypt_json_credentials(p_creds jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb := p_creds;
  v_field  text;
  v_val    text;
BEGIN
  FOREACH v_field IN ARRAY ARRAY['login_password', 'cert_password', 'password'] LOOP
    v_val := v_result ->> v_field;
    IF v_val IS NOT NULL AND v_val != '' THEN
      v_result := jsonb_set(v_result, ARRAY[v_field], to_jsonb(encrypt_credential(v_val)));
    END IF;
  END LOOP;
  RETURN v_result;
END;
$$;

--------------------------------------------------------------------------------
-- decrypt_json_credentials(jsonb) → jsonb with sensitive fields decrypted
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION decrypt_json_credentials(p_creds jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb := p_creds;
  v_field  text;
  v_val    text;
BEGIN
  FOREACH v_field IN ARRAY ARRAY['login_password', 'cert_password', 'password'] LOOP
    v_val := v_result ->> v_field;
    IF v_val IS NOT NULL AND v_val != '' THEN
      BEGIN
        v_result := jsonb_set(v_result, ARRAY[v_field], to_jsonb(decrypt_credential(v_val)));
      EXCEPTION WHEN OTHERS THEN
        -- If decryption fails (value was plaintext or corrupted), leave as-is
        NULL;
      END;
    END IF;
  END LOOP;
  RETURN v_result;
END;
$$;

--------------------------------------------------------------------------------
-- Add encrypted_password column to vault_accounts
-- This column stores PGP-encrypted passwords; login_password will be phased out.
--------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vault_accounts' AND column_name = 'encrypted_password'
  ) THEN
    ALTER TABLE vault_accounts ADD COLUMN encrypted_password text;
  END IF;
END;
$$;

--------------------------------------------------------------------------------
-- Migrate existing plaintext passwords in vault_accounts to encrypted form
--------------------------------------------------------------------------------
UPDATE vault_accounts
SET encrypted_password = encrypt_credential(login_password),
    login_password = '***encrypted***'
WHERE login_password IS NOT NULL
  AND login_password != ''
  AND login_password != '***encrypted***'
  AND encrypted_password IS NULL;

--------------------------------------------------------------------------------
-- Migrate existing plaintext credentials in automation_credentials
--------------------------------------------------------------------------------
UPDATE automation_credentials
SET credentials = encrypt_json_credentials(credentials),
    updated_at = now()
WHERE credentials IS NOT NULL
  AND credentials != '{}'::jsonb
  AND (
    (credentials ->> 'login_password' IS NOT NULL AND credentials ->> 'login_password' != '' AND LEFT(credentials ->> 'login_password', 4) != 'wcBM')
    OR
    (credentials ->> 'cert_password' IS NOT NULL AND credentials ->> 'cert_password' != '' AND LEFT(credentials ->> 'cert_password', 4) != 'wcBM')
  );

--------------------------------------------------------------------------------
-- RPC: encrypt a single credential (for client calls)
--------------------------------------------------------------------------------
-- Already created above as encrypt_credential / decrypt_credential.
-- Grant execute to authenticated users so they can call via RPC.
GRANT EXECUTE ON FUNCTION encrypt_credential(text) TO authenticated;
GRANT EXECUTE ON FUNCTION decrypt_credential(text) TO authenticated;
GRANT EXECUTE ON FUNCTION encrypt_json_credentials(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION decrypt_json_credentials(jsonb) TO authenticated;

-- Keep _get_encryption_key strictly private
REVOKE EXECUTE ON FUNCTION _get_encryption_key() FROM authenticated;
REVOKE EXECUTE ON FUNCTION _get_encryption_key() FROM anon;
