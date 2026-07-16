import { withSentry } from "../_shared/sentry.ts";
// Resend Webhook 수신 — 발송 후 반송(bounced)/스팸(complained)/전달(delivered)/지연(delivery_delayed)
//   이벤트를 받아 signature_requests.delivery_status 갱신 + 반송/스팸은 signature_send_failures 에 기록.
//   인증: Svix 서명(RESEND_WEBHOOK_SECRET) 검증. (Resend → 우리 endpoint, Supabase JWT 없음 → --no-verify-jwt 배포 필요)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") || "";

const STATUS_MAP: Record<string, string> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.delivery_delayed": "delayed",
};

// Svix(=Resend) 서명 검증. 시크릿 미설정 시 검증 생략(설정 전 임시 동작).
async function verifySignature(headers: Headers, body: string): Promise<boolean> {
  if (!WEBHOOK_SECRET) return true;
  const id = headers.get("svix-id");
  const ts = headers.get("svix-timestamp");
  const sigHeader = headers.get("svix-signature");
  if (!id || !ts || !sigHeader) return false;
  try {
    const secretBytes = Uint8Array.from(atob(WEBHOOK_SECRET.replace(/^whsec_/, "")), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`));
    const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
    const provided = sigHeader.split(" ").map((s) => s.split(",")[1]);
    return provided.includes(expected);
  } catch {
    return false;
  }
}

Deno.serve(withSentry("resend-webhook", async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const body = await req.text();
  if (!(await verifySignature(req.headers, body))) {
    return new Response("invalid signature", { status: 401 });
  }

  let event: any;
  try { event = JSON.parse(body); } catch { return new Response("ok"); }

  const status = STATUS_MAP[event?.type];
  const d = event?.data || {};
  const to: string | undefined = Array.isArray(d.to) ? d.to[0] : d.to;
  if (!status || !to) return new Response("ok"); // 관심 없는 이벤트(sent/opened/clicked 등) 또는 수신자 없음

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // 수신 이메일 기준 가장 최근 서명 요청 매칭
  const { data: reqs } = await admin
    .from("signature_requests")
    .select("id, company_id, signer_name, batch_id, partner_id")
    .eq("signer_email", to)
    .order("sent_at", { ascending: false, nullsFirst: false })
    .limit(1);
  const sr = (reqs || [])[0];
  if (!sr) return new Response("ok");

  const detail: string =
    d?.bounce?.message || d?.bounce?.subType || d?.reason ||
    (status === "complained" ? "스팸 신고" : status === "delayed" ? "전달 지연" : "") || "";

  await admin.from("signature_requests")
    .update({ delivery_status: status, delivery_detail: detail || null, delivery_at: new Date().toISOString() })
    .eq("id", sr.id);

  // 반송/스팸은 실패 패널에도 기록
  if (status === "bounced" || status === "complained") {
    await admin.from("signature_send_failures").insert({
      company_id: sr.company_id,
      signature_request_id: sr.id,
      batch_id: sr.batch_id,
      partner_id: sr.partner_id,
      recipient_email: to,
      recipient_name: sr.signer_name,
      send_type: "webhook",
      error_code: status === "bounced" ? "BOUNCED" : "COMPLAINED",
      error_message: detail || event.type,
      failed_at: new Date().toISOString(),
    });
  }

  return new Response("ok");
}));
