//   일정 알림 메일 — 일정 리마인더 크론(schedule_reminders_tick)이 email 플래그가 켜진 알림에서 호출.
//   수신자는 body 가 아니라 일정을 만든 사람(user_id)의 계정 이메일. 임의 주소로는 못 보낸다.
//   호출 권한: 크론 시크릿(X-Cron-Secret) 또는 service_role.
import { tfetch } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

serve(withSentry("send-schedule-reminder-email", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  //   호출 권한 — 크론 시크릿이 있으면 그것만, 없으면 service_role Authorization.
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const hdrSecret = req.headers.get("x-cron-secret") ?? "";
  const auth = req.headers.get("Authorization") ?? "";
  const isService = auth.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "\0");
  if (!((cronSecret && hdrSecret === cronSecret) || isService)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
  }

  const body = await req.json().catch(() => ({}));
  const userId = String(body.user_id || "");
  const title = String(body.title || "(제목 없음)");
  const startAt = String(body.start_at || "");
  const label = String(body.label || "");
  if (!userId) {
    return new Response(JSON.stringify({ ok: false, reason: "no user" }), { headers: { ...cors, "Content-Type": "application/json" } });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data: user } = await supabase.from("users").select("email, name, company_id").eq("id", userId).maybeSingle();
  const email = String(user?.email || "").trim();
  const resendKey = Deno.env.get("RESEND_API_KEY");
  //   회사에서 빠졌거나(company_id null) 묘비 이메일이면 보내지 않는다.
  const invalidEmail = !email || email.endsWith("@removed.invalid") || !user?.company_id;
  if (invalidEmail || !resendKey) {
    return new Response(JSON.stringify({ ok: true, sent: false }), { headers: { ...cors, "Content-Type": "application/json" } });
  }

  //   KST 표시 — start_at 은 timestamptz. 날짜·시각을 한국시간으로.
  let whenText = "";
  try {
    const d = new Date(startAt);
    whenText = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(d);
  } catch { whenText = startAt; }

  const html = [
    `<div style="font-family:Apple SD Gothic Neo,Malgun Gothic,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1c2030">`,
    `<p style="font-size:13px;color:#6b7080;margin:0 0 6px">일정 알림${label ? ` · ${label}` : ""}</p>`,
    `<h2 style="font-size:18px;margin:0 0 4px">${escapeHtml(title)}</h2>`,
    `<p style="font-size:14px;color:#3b4050;margin:0 0 18px">${escapeHtml(whenText)}</p>`,
    `<a href="https://www.owner-view.com/schedule" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-size:13px">일정 보기</a>`,
    `<p style="font-size:11px;color:#9aa0b0;margin-top:18px">일정에 '메일로 받기'를 선택해 발송된 알림입니다.</p>`,
    `</div>`,
  ].join("");

  try {
    await tfetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("RESEND_FROM_EMAIL") || "오너뷰 <noreply@owner-view.com>",
        to: [email],
        subject: `[오너뷰] 일정 알림 · ${title}`,
        html,
      }),
    });
  } catch (_e) {
    return new Response(JSON.stringify({ ok: true, sent: false }), { headers: { ...cors, "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify({ ok: true, sent: true }), { headers: { ...cors, "Content-Type": "application/json" } });
}));

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
