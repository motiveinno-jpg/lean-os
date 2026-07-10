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

  // ── 사용자 알림 설정(notification_prefs) 존중 — 설정>알림의 푸시 마스터/이벤트별 토글·방해금지 ──
  //   prefs 행이 없으면 발송(구독 존재 자체가 opt-in 신호). notifications.type → 설정 이벤트 키 매핑,
  //   미매핑 타입(signature_request 등)은 마스터 토글만 따름.
  const TYPE_TO_EVENT: Record<string, string> = {
    approval: "approval_pending",
    overtime_request: "approval_pending",
    overtime_approved: "approval_pending",
    overtime_rejected: "approval_pending",
    chat: "chat_mention",
    system: "system_alert",
    overtime_auto_clockout: "system_alert",
    payment: "payment_due",
    payment_due: "payment_due",
    tax_invoice: "tax_invoice",
    deal: "deal_status",
    deal_status: "deal_status",
    project: "deal_status",
    weekly_report: "weekly_report",
  };
  try {
    const { data: prefRow } = await admin
      .from("notification_prefs")
      .select("prefs")
      .eq("user_id", userId)
      .maybeSingle();
    const push = prefRow?.prefs?.push;
    if (push) {
      if (push.enabled === false) {
        return new Response(JSON.stringify({ sent: 0, removed: 0, skipped: "push_disabled" }), { headers: { "Content-Type": "application/json" } });
      }
      const eventKey = tag ? TYPE_TO_EVENT[String(tag)] : undefined;
      if (eventKey && push.events && push.events[eventKey] === false) {
        return new Response(JSON.stringify({ sent: 0, removed: 0, skipped: `event_off:${eventKey}` }), { headers: { "Content-Type": "application/json" } });
      }
    }
    // 방해금지 시간 (KST) — 켜져 있으면 그 시간대엔 발송 안 함 (자정 넘김 지원)
    const q = prefRow?.prefs?.quietHours;
    if (q?.enabled && typeof q.start === "string" && typeof q.end === "string") {
      const kst = new Date(Date.now() + 9 * 3600 * 1000);
      const nowMin = kst.getUTCHours() * 60 + kst.getUTCMinutes();
      const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
      const s = toMin(q.start), e = toMin(q.end);
      const inQuiet = s <= e ? (nowMin >= s && nowMin < e) : (nowMin >= s || nowMin < e);
      if (inQuiet) {
        return new Response(JSON.stringify({ sent: 0, removed: 0, skipped: "quiet_hours" }), { headers: { "Content-Type": "application/json" } });
      }
    }
  } catch { /* prefs 조회 실패 시 발송 계속 (fail-open) */ }

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
