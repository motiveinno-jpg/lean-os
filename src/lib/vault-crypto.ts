// 파일보관함 잠금 — 브라우저 안에서만 암호화·복호화한다.
//
//   비밀번호는 어디에도 저장하지 않는다(서버·DB·브라우저 저장소 모두). 서버에는 알아볼 수 없는 덩어리만 올라가므로
//   운영자·DB 관리자·AI(MCP)도 내용을 못 본다. 대신 비밀번호를 잊으면 아무도 되살릴 수 없다.
//
//   방식: 비밀번호 → PBKDF2-SHA256(600,000회, 파일마다 새 소금 16바이트) → AES-256-GCM(새 IV 12바이트).
//   GCM 은 내용이 바뀌거나 비밀번호가 틀리면 풀기 자체가 실패한다 — '틀린 비밀번호로 깨진 파일'이 나오지 않는다.
//
//   파일 형식: "OVLK1"(5) + 소금(16) + IV(12) + 암호문(태그 16 포함). 머리에 풀기에 필요한 값이 다 있어
//   DB 기록 없이 내려받은 파일만으로도 풀 수 있다. DB(document_files.encryption)에는 화면용 정보만 둔다.

export const LOCK_MAGIC = "OVLK1";
export const LOCK_ITERATIONS = 600_000;
export const LOCK_MIN_PASSWORD = 8;
const SALT_LEN = 16;
const IV_LEN = 12;
const HEAD_LEN = LOCK_MAGIC.length + SALT_LEN + IV_LEN;

/** document_files.encryption 에 남기는 값 — 비밀이 아닌 것만 */
export type VaultLockMeta = {
  v: 1;
  alg: "AES-GCM";
  kdf: "PBKDF2-SHA256";
  iter: number;
  /** 원본의 형식·크기 — 풀어서 내려줄 때 쓴다 */
  mime: string;
  size: number;
};

export class WrongPasswordError extends Error {
  constructor() { super("비밀번호가 맞지 않습니다."); this.name = "WrongPasswordError"; }
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}

export function lockPasswordProblem(password: string, confirm?: string): string | null {
  if (password.length < LOCK_MIN_PASSWORD) return `비밀번호는 ${LOCK_MIN_PASSWORD}자 이상으로 정해 주세요.`;
  if (confirm !== undefined && password !== confirm) return "두 비밀번호가 다릅니다.";
  return null;
}

/** 원본 → 잠긴 덩어리 */
export async function lockBytes(plain: ArrayBuffer, password: string, mime: string): Promise<{ data: Uint8Array; meta: VaultLockMeta }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(password, salt, LOCK_ITERATIONS);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plain));
  const out = new Uint8Array(HEAD_LEN + cipher.length);
  out.set(new TextEncoder().encode(LOCK_MAGIC), 0);
  out.set(salt, LOCK_MAGIC.length);
  out.set(iv, LOCK_MAGIC.length + SALT_LEN);
  out.set(cipher, HEAD_LEN);
  return { data: out, meta: { v: 1, alg: "AES-GCM", kdf: "PBKDF2-SHA256", iter: LOCK_ITERATIONS, mime: mime || "application/octet-stream", size: plain.byteLength } };
}

/** 잠긴 덩어리 → 원본. 비밀번호가 틀리면 WrongPasswordError */
export async function unlockBytes(locked: ArrayBuffer, password: string, iterations: number = LOCK_ITERATIONS): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(locked);
  if (bytes.length < HEAD_LEN + 16 || new TextDecoder().decode(bytes.subarray(0, LOCK_MAGIC.length)) !== LOCK_MAGIC) {
    throw new Error("암호화된 파일 형식이 아닙니다. 파일이 손상됐을 수 있습니다.");
  }
  const salt = bytes.slice(LOCK_MAGIC.length, LOCK_MAGIC.length + SALT_LEN);
  const iv = bytes.slice(LOCK_MAGIC.length + SALT_LEN, HEAD_LEN);
  const key = await deriveKey(password, salt, iterations);
  try {
    return await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, bytes.subarray(HEAD_LEN));
  } catch {
    throw new WrongPasswordError();
  }
}
