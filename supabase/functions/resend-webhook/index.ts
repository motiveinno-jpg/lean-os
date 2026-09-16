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

// Svix(=Resend) 서명 검증. 시크릿 미설정 시 fail-closed (2026-08-24 보안: 예전엔 미설정 시
//   검증을 생략(return true)해 아무나 delivery_status·send_failures 를 위조할 수 있었다).
async function verifySignature(headers: Headers, body: string): Promise<boolean> {
  if (!WEBHOOK_SECRET) return false;
  const id = headers.get("svix-id");
  const ts = headers.get("svix-timestamp");
  const sigHeader = headers.get("svix-signature");
  if (!id || !ts || !sigHeader) return false;
  //   재전송 방지 — 서명된 timestamp 가 지금과 5분 넘게 차이 나면 버린다
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) return false;
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

  // ── 받은 메일(email.received) — 광고 메일 회신 등 owner-view.com 으로 온 메일을 받은 메일함에 넣는다 (2026-09-16) ──
  //   웹훅에는 본문이 없어 Receiving API 로 한 번 더 받는다. 읽기 권한이 있는 키(RESEND_READ_KEY)가 필요하다.
  if (event?.type === "email.received") {
    const rd = event.data || {};
    const emailId = String(rd.email_id || "");
    if (!emailId) return new Response("ok");
    const admin0 = createClient(SUPABASE_URL, SERVICE_KEY);
    const readKey = Deno.env.get("RESEND_READ_KEY") || Deno.env.get("RESEND_API_KEY") || "";
    let full: any = null;
    try {
      const r = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, { headers: { Authorization: `Bearer ${readKey}` } });
      if (r.ok) full = await r.json();
      else console.warn("[resend-webhook] receiving fetch failed", r.status);
    } catch (e) { console.warn("[resend-webhook] receiving fetch error", e); }
    //   본문을 못 받아도 제목·발신자는 웹훅에 있으니 일단 남긴다 — 운영자가 Resend 에서 원문을 볼 수 있다
    const fromRaw = String(full?.from || rd.from || "");
    const m = fromRaw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
    const fromEmail = (m ? m[2] : fromRaw).trim().toLowerCase();
    const fromName = m ? m[1].trim() : null;
    const toList: string[] = (Array.isArray(full?.to) ? full.to : Array.isArray(rd.to) ? rd.to : []).map((t: string) => String(t).toLowerCase());
    //   이 주소로 보낸 가장 최근 캠페인에 묶어 둔다(회신인지 보기 위해)
    let campaignId: string | null = null;
    if (fromEmail) {
      const { data: rcpt } = await admin0.from("email_campaign_recipients").select("campaign_id")
        .eq("email", fromEmail).not("sent_at", "is", null).order("sent_at", { ascending: false }).limit(1).maybeSingle();
      campaignId = rcpt?.campaign_id || null;
    }
    await admin0.from("email_inbox").upsert({
      resend_id: emailId,
      message_id: full?.message_id || rd.message_id || null,
      from_email: fromEmail || "(알 수 없음)",
      from_name: fromName,
      to_emails: toList,
      subject: full?.subject ?? rd.subject ?? null,
      text_body: full?.text ?? null,
      html_body: full?.html ?? null,
      attachments: Array.isArray(full?.attachments) ? full.attachments : (Array.isArray(rd.attachments) ? rd.attachments : []),
      received_at: full?.created_at || rd.created_at || new Date().toISOString(),
      campaign_id: campaignId,
    }, { onConflict: "resend_id" });
    return new Response("ok");
  }

  const status = STATUS_MAP[event?.type];
  const d = event?.data || {};
  const to: string | undefined = Array.isArray(d.to) ? d.to[0] : d.to;
  if (!status || !to) return new Response("ok"); // 관심 없는 이벤트(sent/opened/clicked 등) 또는 수신자 없음

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const detailOf = (): string =>
    d?.bounce?.message || d?.bounce?.subType || d?.reason ||
    (status === "complained" ? "스팸 신고" : status === "delayed" ? "전달 지연" : "") || "";

  // ── 광고 캠페인 메일(email-campaign-send) — Resend 메일 id 로 수신자 행을 찾는다 (2026-09-16) ──
  //   반송·스팸신고는 수신거부 목록(email_optouts)에 넣어 다음 발송에서 자동으로 빠지게 한다.
  const emailId: string | undefined = d?.email_id;
  if (emailId) {
    const { data: rcpt } = await admin.from("email_campaign_recipients")
      .select("id, campaign_id, email").eq("resend_id", emailId).maybeSingle();
    if (rcpt) {
      const now = new Date().toISOString();
      await admin.from("email_campaign_recipients")
        .update({ status, error: status === "bounced" || status === "complained" ? (detailOf() || event.type).slice(0, 300) : null, updated_at: now })
        .eq("id", rcpt.id);
      if (status === "bounced" || status === "complained") {
        await admin.from("email_optouts").upsert(
          { email: String(rcpt.email).toLowerCase(), source: status === "bounced" ? "bounce" : "complaint", note: (detailOf() || event.type).slice(0, 200) },
          { onConflict: "email", ignoreDuplicates: true },
        );
      }
      return new Response("ok");   // 캠페인 메일은 서명 요청과 무관 — 여기서 끝
    }
  }

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
