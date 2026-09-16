import { withSentry } from "../_shared/sentry.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { escapeHtml } from "../_shared/mail-guard.ts";

// 광고·소개 메일 직접 발송 (2026-09-16) — 운영자 화면 「매출 › 메일 보내기」가 부른다.
//
//   · 플랫폼 운영자만(is_platform_operator). 회사 사용자 권한으로는 호출 불가.
//   · 발신은 광고 전용 서브도메인 news.mo-tive.com — 계약서·급여 메일(mo-tive.com)과 평판을 섞지 않는다.
//   · 정보통신망법 제50조: 제목 앞 "(광고)", 발신자 명칭·연락처, 수신거부 방법을 본문에 반드시 넣는다 → 여기서 자동으로 붙인다.
//   · 수신거부(email_optouts)는 보내기 직전에 대조해 자동으로 뺀다. 반송·스팸신고로 들어온 주소도 같은 표라 함께 빠진다.
//   · List-Unsubscribe / List-Unsubscribe-Post 헤더 — 지메일 등이 메일 상단에 '수신거부' 버튼을 띄운다(스팸 신고 대신 이걸 누르게).
//   · dry_run=true 면 보내지 않고 "총 N · 수신거부 제외 M · 발송 예정 K" 만 돌려준다.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";

const FROM_EMAIL = "오너뷰 <hello@news.mo-tive.com>";
const REPLY_TO = "creative@mo-tive.com";
const SITE = "https://www.owner-view.com";
const MAX_RECIPIENTS = 2000;
const BATCH = 100;               // Resend /emails/batch 한 번에 최대 100통
const BATCH_GAP_MS = 700;        // Resend 기본 2 req/s

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** 본문 끝에 법이 요구하는 안내를 붙인다 — 텍스트/HTML 두 벌 */
function withFooter(bodyText: string, unsubUrl: string) {
  const footerText =
    `\n\n──────────\n` +
    `이 메일은 정보통신망법에 따른 광고성 정보입니다.\n` +
    `발신: 주식회사 모티브이노베이션 (오너뷰) · ${REPLY_TO}\n` +
    `수신을 원하지 않으시면 아래 주소에서 바로 거부하실 수 있습니다.\n` +
    `수신거부: ${unsubUrl}\n`;
  const html =
    `<div style="font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:15px;line-height:1.7;color:#18181b;max-width:640px">` +
    `<div style="white-space:pre-wrap">${escapeHtml(bodyText)}</div>` +
    `<hr style="border:0;border-top:1px solid #e5e8f0;margin:28px 0 16px">` +
    `<p style="font-size:12px;line-height:1.7;color:#71717a;margin:0">` +
    `이 메일은 정보통신망법에 따른 광고성 정보입니다.<br>` +
    `발신: 주식회사 모티브이노베이션 (오너뷰) · ${REPLY_TO}<br>` +
    `수신을 원하지 않으시면 <a href="${unsubUrl}" style="color:#4f46e5">여기서 바로 거부</a>하실 수 있습니다.` +
    `</p></div>`;
  return { text: bodyText + footerText, html };
}

Deno.serve(withSentry("email-campaign-send", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // ── 운영자 확인 ──
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "인증이 필요합니다." }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: ud, error: ue } = await userClient.auth.getUser();
  if (ue || !ud.user) return json({ error: "인증이 필요합니다." }, 401);
  const { data: isOp } = await userClient.rpc("is_platform_operator");
  if (isOp !== true) return json({ error: "운영자만 보낼 수 있습니다." }, 403);
  if (!RESEND_API_KEY) return json({ error: "발송 키(RESEND_API_KEY)가 없습니다." }, 500);

  // ── 입력 ──
  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dry_run === true;
  let subject = String(body?.subject || "").trim().slice(0, 200);
  const bodyText = String(body?.body_text || "").trim().slice(0, 20000);
  const rawList: unknown[] = Array.isArray(body?.recipients) ? body.recipients : [];
  if (!subject) return json({ error: "제목을 적어 주세요." }, 400);
  if (!bodyText) return json({ error: "본문을 적어 주세요." }, 400);
  //   법 요건 — 제목 맨 앞에 (광고). 사람이 빼먹어도 여기서 붙인다.
  if (!/^\(광고\)/.test(subject)) subject = `(광고) ${subject}`;

  const seen = new Set<string>();
  const invalid: string[] = [];
  for (const v of rawList) {
    const e = String(v || "").trim().toLowerCase();
    if (!e) continue;
    if (!isEmail(e)) { invalid.push(e); continue; }
    seen.add(e);
  }
  const recipients = [...seen];
  if (recipients.length === 0) return json({ error: "보낼 주소가 없습니다." }, 400);
  if (recipients.length > MAX_RECIPIENTS) return json({ error: `한 번에 ${MAX_RECIPIENTS}명까지 보낼 수 있습니다.` }, 400);

  // ── 수신거부 대조 ──
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const opted = new Set<string>();
  for (let i = 0; i < recipients.length; i += 500) {
    const { data } = await admin.from("email_optouts").select("email").in("email", recipients.slice(i, i + 500));
    for (const r of (data || []) as { email: string }[]) opted.add(r.email.toLowerCase());
  }
  const toSend = recipients.filter((e) => !opted.has(e));
  const summary = { total: recipients.length, skipped_optout: opted.size, will_send: toSend.length, invalid };
  if (dryRun) return json({ ok: true, dry_run: true, ...summary });

  // ── 캠페인 기록 ──
  const { data: camp, error: cErr } = await admin.from("email_campaigns")
    .insert({ subject, body_text: bodyText, from_email: FROM_EMAIL, status: "sending", total: recipients.length, skipped_optout: opted.size, created_by: ud.user.id })
    .select("id").single();
  if (cErr || !camp) return json({ error: "캠페인 기록 실패: " + (cErr?.message || "") }, 500);
  const campaignId = camp.id as string;
  const rows = recipients.map((email) => ({ campaign_id: campaignId, email, status: opted.has(email) ? "skipped_optout" : "queued" }));
  for (let i = 0; i < rows.length; i += 500) await admin.from("email_campaign_recipients").insert(rows.slice(i, i + 500));

  // ── 발송 (100통씩 묶어서) ──
  let sent = 0, failed = 0;
  for (let i = 0; i < toSend.length; i += BATCH) {
    const chunk = toSend.slice(i, i + BATCH);
    const payload = chunk.map((email) => {
      //   사람이 누르는 링크는 화면(/unsubscribe/), 메일 앱의 원클릭 POST 는 API(/api/unsubscribe/) — 사이트가 끝 슬래시로
      //   308 을 보내므로 헤더 주소는 처음부터 슬래시를 붙인다(POST 리다이렉트를 안 따르는 메일 앱 대비).
      const unsubUrl = `${SITE}/unsubscribe/?email=${encodeURIComponent(email)}`;
      const oneClickUrl = `${SITE}/api/unsubscribe/?email=${encodeURIComponent(email)}`;
      const { text, html } = withFooter(bodyText, unsubUrl);
      return {
        from: FROM_EMAIL, to: [email], reply_to: REPLY_TO, subject, text, html,
        headers: {
          "List-Unsubscribe": `<${oneClickUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        tags: [{ name: "campaign", value: campaignId }],
      };
    });
    let ok = false; let ids: string[] = []; let errMsg = "";
    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(j?.data)) { ok = true; ids = j.data.map((d: { id?: string }) => d?.id || ""); }
      else errMsg = j?.message || `HTTP ${res.status}`;
    } catch (e) { errMsg = e instanceof Error ? e.message : String(e); }
    const now = new Date().toISOString();
    if (ok) {
      for (let k = 0; k < chunk.length; k++) {
        await admin.from("email_campaign_recipients")
          .update({ status: "sent", resend_id: ids[k] || null, sent_at: now, updated_at: now })
          .eq("campaign_id", campaignId).eq("email", chunk[k]);
      }
      sent += chunk.length;
    } else {
      await admin.from("email_campaign_recipients")
        .update({ status: "failed", error: errMsg.slice(0, 300), updated_at: now })
        .eq("campaign_id", campaignId).in("email", chunk);
      failed += chunk.length;
    }
    if (i + BATCH < toSend.length) await new Promise((r) => setTimeout(r, BATCH_GAP_MS));
  }

  await admin.from("email_campaigns")
    .update({ status: failed > 0 && sent === 0 ? "failed" : "sent", sent_count: sent, failed_count: failed, sent_at: new Date().toISOString() })
    .eq("id", campaignId);

  return json({ ok: true, campaign_id: campaignId, ...summary, sent, failed });
}));
