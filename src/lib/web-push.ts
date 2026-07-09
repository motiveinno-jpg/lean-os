// 웹 푸시(백그라운드) 구독 — 탭이 닫혀 있어도 알림 수신.
//   PushManager 구독 → push_subscriptions 저장. 발송은 edge(send-web-push).
//   VAPID 공개키는 노출돼도 안전(발송은 개인키 보유 서버만 가능).
import { supabase } from "./supabase";

const VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  "BO9P1WY9KeMl9BSzhunf1kwJ7kO9l2FGiyja0MiVq6zfM7MLFEfS4BK_SSCtb0N8ffqvDYGbFFfzxGHwx1c-EsI";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function webPushSupported(): boolean {
  return typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
}

/** 현재 브라우저가 이미 구독돼 있는지 */
export async function isWebPushSubscribed(): Promise<boolean> {
  if (!webPushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    return !!(await reg.pushManager.getSubscription());
  } catch { return false; }
}

/** 구독 + DB 저장. 권한 거부/미지원이면 false. */
export async function subscribeWebPush(companyId: string | null, userId: string): Promise<boolean> {
  if (!webPushSupported()) return false;
  if (Notification.permission !== "granted") {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return false;
  }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    });
  }
  const json = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } };
  if (!json.keys?.p256dh || !json.keys?.auth) return false;
  const { error } = await (supabase as any).from("push_subscriptions").upsert({
    user_id: userId,
    company_id: companyId,
    endpoint: sub.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    user_agent: navigator.userAgent,
  }, { onConflict: "endpoint" });
  return !error;
}

/** 구독 해제 + DB 삭제. */
export async function unsubscribeWebPush(): Promise<void> {
  if (!webPushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await (supabase as any).from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
  } catch { /* best-effort */ }
}
