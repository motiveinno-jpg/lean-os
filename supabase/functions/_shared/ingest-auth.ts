// 외부 인입(n8n 등) 인증 공용 (2026-09-07 보안 정비)
//   · safeEqual      시크릿 비교는 길이·시간에 무관하게
//   · checkIngestSecret 플랫폼 시크릿(x-ingest-secret)
//   · resolveIngestCompany 회사별 비밀키(x-api-key = ovk_…) → company_id. 키를 발급한 적 없는 회사는 과도기 동안 UUID 허용
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i % x.length] ?? 0) ^ (y[i % y.length] ?? 0);
  return diff === 0;
}

export function checkIngestSecret(req: Request): boolean {
  const expected = Deno.env.get("N8N_INGEST_SECRET");
  if (!expected) return false;
  return safeEqual(req.headers.get("x-ingest-secret"), expected);
}

export async function resolveIngestCompany(req: Request): Promise<string | null> {
  const key = (req.headers.get("x-api-key") || "").trim();
  if (!key) return null;
  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data, error } = await admin.rpc("ingest_company_for_key", { p_key: key });
  if (error) { console.error("[ingest-auth] key lookup failed:", error.message); return null; }
  return (data as string | null) || null;
}

/** 계좌·카드번호는 뒤 4자리만 남긴다 */
export function maskTail(v: unknown): string {
  const s = String(v ?? "");
  const digits = s.replace(/[^0-9]/g, "");
  if (!s || digits.length <= 4) return s;
  return "*".repeat(Math.max(s.length - 4, 0)) + s.slice(-4);
}
