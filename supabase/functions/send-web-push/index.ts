// send-web-push — 저장된 push_subscriptions 로 웹 푸시 발송 (백그라운드 알림).
//   호출: notifications AFTER INSERT 트리거(pg_net) → 이 함수. x-push-secret 헤더로 보호.
//   죽은 구독(404/410)은 자동 삭제. VAPID 개인키는 엣지 시크릿(VAPID_PRIVATE_KEY).
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:creative@mo-tive.com";
const HOOK_SECRET = Deno.env.get("PUSH_HOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!HOOK_SECRET || req.headers.get("x-push-secret") !== HOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return new Response("VAPID keys not configured", { status: 500 });
  }

  let payload: any;
  try { payload = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
  const { userId, title, body, url, tag } = payload || {};
  if (!userId || !title) return new Response("missing userId/title", { status: 400 });

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (!subs || subs.length === 0) {
    return new Response(JSON.stringify({ sent: 0, removed: 0 }), { headers: { "Content-Type": "application/json" } });
  }

  const notif = JSON.stringify({ title, body: body || "", url: url || "/", tag: tag || undefined });
  let sent = 0, removed = 0;
  for (const s of subs as any[]) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        notif,
      );
      sent++;
    } catch (e: any) {
      const code = e?.statusCode;
      if (code === 404 || code === 410) {
        await admin.from("push_subscriptions").delete().eq("id", s.id);
        removed++;
      }
    }
  }
  return new Response(JSON.stringify({ sent, removed }), { headers: { "Content-Type": "application/json" } });
});
