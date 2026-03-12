import { supabase } from './supabase';

const db = supabase as any;

/**
 * Encrypt a plaintext credential using server-side pgcrypto (AES-256).
 * The encryption key never leaves the database.
 *
 * @param plaintext - The credential to encrypt
 * @returns Base64-encoded PGP ciphertext, or null if input is empty
 */
export async function encryptCredential(plaintext: string): Promise<string | null> {
  if (!plaintext || plaintext.trim() === '') return null;

  const { data, error } = await db.rpc('encrypt_credential', {
    p_plaintext: plaintext,
  });

  if (error) {
    console.error('[crypto] encrypt_credential RPC failed:', error.message);
    throw new Error('Failed to encrypt credential');
  }

  return data as string;
}

/**
 * Decrypt a previously encrypted credential using server-side pgcrypto.
 *
 * @param ciphertext - Base64-encoded PGP ciphertext
 * @returns The original plaintext, or null if input is empty
 */
export async function decryptCredential(ciphertext: string): Promise<string | null> {
  if (!ciphertext || ciphertext.trim() === '' || ciphertext === '***encrypted***') return null;

  const { data, error } = await db.rpc('decrypt_credential', {
    p_ciphertext: ciphertext,
  });

  if (error) {
    console.error('[crypto] decrypt_credential RPC failed:', error.message);
    throw new Error('Failed to decrypt credential');
  }

  return data as string;
}

/**
 * Encrypt sensitive fields within a JSON credentials object.
 * Encrypts: login_password, cert_password, password
 *
 * @param credentials - The credentials JSON object
 * @returns A new object with sensitive fields encrypted
 */
export async function encryptJsonCredentials(
  credentials: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!credentials || Object.keys(credentials).length === 0) return credentials;

  const { data, error } = await db.rpc('encrypt_json_credentials', {
    p_creds: credentials,
  });

  if (error) {
    console.error('[crypto] encrypt_json_credentials RPC failed:', error.message);
    throw new Error('Failed to encrypt credentials');
  }

  return data as Record<string, unknown>;
}

/**
 * Decrypt sensitive fields within a JSON credentials object.
 * Decrypts: login_password, cert_password, password
 *
 * @param credentials - The credentials JSON object with encrypted fields
 * @returns A new object with sensitive fields decrypted
 */
export async function decryptJsonCredentials(
  credentials: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!credentials || Object.keys(credentials).length === 0) return credentials;

  const { data, error } = await db.rpc('decrypt_json_credentials', {
    p_creds: credentials,
  });

  if (error) {
    console.error('[crypto] decrypt_json_credentials RPC failed:', error.message);
    throw new Error('Failed to decrypt credentials');
  }

  return data as Record<string, unknown>;
}
