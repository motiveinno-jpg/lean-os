import { tfetch } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * OwnerView — 결제 성공 내부 알림 메일 (creative@mo-tive.com).
 *   Next 웹훅(진실원천, /api/stripe/webhook)이 invoice.paid(실결제, amount>0) 확인 후 호출.
 *   중복방지: billing_email_deliveries(stripe_event_id/stripe_invoice_id UNIQUE) — 재전송에도 1통.
 *   ⚠️ 수신자는 env(BILLING_NOTIFICATION_EMAIL)로 고정 — 클라(호출측)가 바꿀 수 없음.
 *   ⚠️ 카드번호·CVC·결제수단 원문 등 민감정보 미포함. Resend 실패해도 결제 웹훅은 성공 유지(여기서 200/기록만).
 *   가드: x-internal-secret === BILLING_HOOK_SECRET (웹훅만 호출 가능).
 */
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-internal-secret" };
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const won = (n: number) => "₩" + Math.round(n).toLocaleString("ko-KR");
const kst = (iso?: string | null) => {
  if (!iso) return "-";
  try { return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return "-"; }
};
const TYPE_LABEL: Record<string, string> = { new: "신규 구독 첫 결제 완료", renewal: "구독 갱신 완료", change: "플랜 변경 결제 완료", failed: "구독 결제 실패 — 결제수단 확인 필요" };
const TYPE_SUBJECT: Record<string, string> = { new: "신규 구독 첫 결제 완료", renewal: "구독 갱신 완료", change: "플랜 변경 결제 완료", failed: "⚠️ 구독 결제 실패" };

serve(withSentry("send-billing-notification", async (req) => {
  const j = (b: Record<string, unknown>, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return j({ error: "Method not allowed" }, 405);

  // 가드
  const secret = Deno.env.get("BILLING_HOOK_SECRET");
  if (!secret || req.headers.get("x-internal-secret") !== secret) return j({ error: "forbidden" }, 403);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const now = new Date().toISOString();

  try {
    const p = await req.json().catch(() => ({}));
    const stripeEventId = String(p.stripe_event_id || "");
    const stripeInvoiceId = String(p.stripe_invoice_id || "");
    const notificationType = ["new", "renewal", "change", "failed"].includes(p.notification_type) ? p.notification_type : "renewal";
    // 성공(new/renewal/change)은 invoice_id 로, 실패(failed)는 event_id 로 멱등 — 둘 중 하나는 필수.
    if (!stripeInvoiceId && !stripeEventId) return j({ error: "stripe_invoice_id or stripe_event_id required" }, 400);

    // 수신자는 서버 env 고정 (클라 지정 불가)
    const recipient = Deno.env.get("BILLING_NOTIFICATION_EMAIL") || "creative@mo-tive.com";

    // ── 중복방지: insert(pending) → 충돌 시 기존 행 확인 ──
    const { data: ins, error: insErr } = await admin.from("billing_email_deliveries").insert({
      stripe_event_id: stripeEventId || null,
      stripe_invoice_id: stripeInvoiceId || null,   // "" 금지 — 실패 메일은 invoice_id 없이 event_id 로만 멱등
      company_id: p.company_id || null,
      subscription_id: p.stripe_subscription_id || null,
      notification_type: notificationType,
      recipient,
      status: "pending",
      attempts: 1,
    }).select("id").maybeSingle();

    let rowId: string;
    if (insErr) {
      if (insErr.code === "23505") {
        const orParts: string[] = [];
        if (stripeInvoiceId) orParts.push(`stripe_invoice_id.eq.${stripeInvoiceId}`);
        if (stripeEventId) orParts.push(`stripe_event_id.eq.${stripeEventId}`);
        const { data: ex } = await admin.from("billing_email_deliveries")
          .select("id, status, attempts")
          .or(orParts.join(","))
          .limit(1).maybeSingle();
        if (!ex) return j({ error: "conflict_no_row" }, 500);
        if (ex.status === "sent") return j({ ok: true, skipped: true, reason: "already_sent" }); // 재발송 금지
        rowId = ex.id; // pending/failed → 재시도
        await admin.from("billing_email_deliveries").update({ attempts: (ex.attempts || 0) + 1, updated_at: now }).eq("id", rowId);
      } else {
        return j({ error: "db_error" }, 500);
      }
    } else {
      rowId = ins!.id;
    }

    // ── 메일 구성 ──
    const label = TYPE_LABEL[notificationType];
    const subject = `[OwnerView 결제] ${TYPE_SUBJECT[notificationType]} — ${p.company_name || "회사"}`;
    const rows: [string, string][] = [
      ["결제 유형", label],
      ["회사명", String(p.company_name || "-")],
      ["회사 ID", String(p.company_id || "-")],
      ["대표자/결제 계정", String(p.payer || "-")],
      ["플랜", String(p.plan_name || "-")],
      ["좌석 수", `${p.seat_count ?? "-"}명`],
      [notificationType === "failed" ? "청구 실패 금액" : "결제 금액", won(Number(p.amount_krw || 0)) + " (VAT 포함 청구액)"],
      [notificationType === "failed" ? "실패 시각(KST)" : "결제 시각(KST)", kst(p.paid_at || now)],
      ...(notificationType === "failed" && p.attempt_count != null ? [["결제 시도 횟수", `${p.attempt_count}회`] as [string, string]] : []),
      ["다음 결제 예정", kst(p.next_billing_at)],
      ...(p.trial_end ? [["트라이얼 종료(첫 결제)", kst(p.trial_end)] as [string, string]] : []),
      ["Stripe invoice", String(p.stripe_invoice_id || "-")],
      ["Stripe subscription", String(p.stripe_subscription_id || "-")],
    ];
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1613">
      <div style="background:#1a1613;color:#fff;padding:22px 24px;border-radius:12px 12px 0 0">
        <div style="font-size:13px;opacity:.7">OwnerView 결제 알림</div>
        <h1 style="margin:6px 0 0;font-size:19px">${esc(label)}</h1>
      </div>
      <div style="border:1px solid #e7e5e4;border-top:none;border-radius:0 0 12px 12px;padding:22px 24px">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          ${rows.map(([k, v]) => `<tr><td style="padding:9px 0;color:#57534e;width:42%;vertical-align:top">${esc(k)}</td><td style="padding:9px 0;font-weight:600;color:#1a1613">${esc(v)}</td></tr>`).join("")}
        </table>
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e7e5e4">
          <a href="https://www.owner-view.com/billing" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:600;font-size:14px">결제 관리 화면 열기</a>
        </div>
        <p style="font-size:11px;color:#a8a29e;margin-top:16px">내부 알림 메일입니다. 카드·결제수단 원문 정보는 포함되지 않습니다.</p>
      </div>
    </body></html>`;

    // ── Resend 발송 (실패해도 결제 성공엔 영향 없음 — 상태만 기록) ──
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      await admin.from("billing_email_deliveries").update({ status: "failed", last_error: "RESEND_API_KEY missing", updated_at: now }).eq("id", rowId);
      return j({ ok: false, status: "failed", error: "no_resend_key" }, 200);
    }
    const res = await tfetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: Deno.env.get("RESEND_FROM_EMAIL") || "OwnerView <noreply@owner-view.com>", to: [recipient], subject, html }),
    });
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      await admin.from("billing_email_deliveries").update({ status: "sent", resend_email_id: body?.id || null, sent_at: now, last_error: null, updated_at: now }).eq("id", rowId);
      return j({ ok: true, status: "sent" });
    } else {
      const err = (await res.text().catch(() => "send failed")).slice(0, 500);
      await admin.from("billing_email_deliveries").update({ status: "failed", last_error: err, updated_at: now }).eq("id", rowId);
      return j({ ok: false, status: "failed", error: "resend_failed" }, 200); // 웹훅엔 실패로 안 넘김
    }
  } catch (_e) {
    return j({ error: "internal" }, 200);
  }
}));
