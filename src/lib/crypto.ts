import { supabase } from './supabase';

const db = supabase;

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
