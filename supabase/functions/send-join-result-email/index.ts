import { tfetch } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * OwnerView — 회사 합류 요청 결과 메일 (승인/거절)
 *   ⚠️ send-invite-email 과 달리 수신자·URL·회사명을 클라가 지정하지 못한다.
 *   입력은 { requestId } 뿐 — 수신 이메일·회사명·상태·역할은 전부 서버가 DB에서 읽는다.
 *   가드: 호출자 JWT 가 그 요청 회사의 owner/admin 이어야 함. 사업자번호는 본문에 절대 노출 안 함.
 *   승인 롤백 금지 — 메일 실패해도 delivery_status/error 만 기록하고 200 계열로 결과 반환.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const LOGIN_URL = "https://www.owner-view.com/auth/";
const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const roleLabel = (r: string) => (r === "admin" ? "관리자" : "직원");

serve(withSentry("send-join-result-email", async (req) => {
  const j = (b: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return j({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: uErr } = await admin.auth.getUser(token);
    if (!user || uErr) return j({ error: "Unauthorized" }, 401);

    const { data: caller } = await admin.from("users").select("company_id, role").eq("auth_id", user.id).maybeSingle();
    if (!caller?.company_id || !["owner", "admin"].includes(caller.role || "")) {
      return j({ error: "대표/관리자만 사용할 수 있습니다." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const requestId = String(body?.requestId || "");
    if (!requestId) return j({ error: "requestId required" }, 400);

    // 수신자·회사·상태·역할은 전부 서버가 DB 에서 읽음 (클라 입력 불신)
    const { data: rq } = await admin.from("company_join_requests")
      .select("id, company_id, requester_email, status, granted_role, rejection_reason, companies(name)")
      .eq("id", requestId).maybeSingle();
    if (!rq) return j({ error: "요청을 찾을 수 없습니다." }, 404);
    if (rq.company_id !== caller.company_id) return j({ error: "다른 회사의 요청입니다." }, 403);
    if (!["approved", "rejected"].includes(rq.status)) {
      return j({ error: "승인 또는 거절된 요청만 메일을 보낼 수 있습니다." }, 400);
    }

    const company = esc((rq as { companies?: { name?: string } }).companies?.name || "회사");
    const to = rq.requester_email as string;
    const approved = rq.status === "approved";

    const subject = approved
      ? `[OwnerView] ${company} 가입이 승인되었습니다`
      : `[OwnerView] 회사 가입 요청 결과 안내`;

    const html = approved
      ? `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
        <div style="background:#1a1a2e;color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center">
          <h1 style="margin:0;font-size:20px">${company}</h1>
          <p style="margin:8px 0 0;opacity:0.8;font-size:14px">가입 승인 안내</p>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px">
          <h2 style="margin:0 0 16px;font-size:18px;color:#1a1a2e">가입이 승인되었습니다</h2>
          <p style="font-size:14px;color:#374151;line-height:1.6">
            <strong>${company}</strong> 가입 요청이 대표/관리자에 의해 승인되었습니다.
            부여된 역할은 <strong>${esc(roleLabel(String(rq.granted_role || "employee")))}</strong> 입니다.
            아래 버튼으로 로그인하면 회사 페이지를 사용할 수 있습니다.
          </p>
          <div style="text-align:center;margin:24px 0">
            <a href="${LOGIN_URL}" style="display:inline-block;background:#3B82F6;color:#fff;text-decoration:none;padding:14px 40px;border-radius:8px;font-weight:bold;font-size:15px">OwnerView 로그인</a>
          </div>
          <p style="font-size:12px;color:#9ca3af;text-align:center">${LOGIN_URL}</p>
        </div>
      </body></html>`
      : `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
        <div style="background:#1a1a2e;color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center">
          <h1 style="margin:0;font-size:20px">OwnerView</h1>
          <p style="margin:8px 0 0;opacity:0.8;font-size:14px">가입 요청 결과 안내</p>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px">
          <h2 style="margin:0 0 16px;font-size:18px;color:#1a1a2e">가입 요청이 거절되었습니다</h2>
          <p style="font-size:14px;color:#374151;line-height:1.6">
            요청하신 <strong>${company}</strong> 가입이 승인되지 않았습니다.
            ${rq.rejection_reason ? `<br/>사유: ${esc(String(rq.rejection_reason))}` : ""}
          </p>
          <p style="font-size:13px;color:#6b7280;line-height:1.6">자세한 내용은 회사 대표 또는 관리자에게 문의해주세요.</p>
        </div>
      </body></html>`;

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    let deliveryStatus = "sent";
    let deliveryError: string | null = null;

    if (!RESEND_API_KEY) {
      deliveryStatus = "failed";
      deliveryError = "RESEND_API_KEY missing";
    } else {
      const r = await tfetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from: Deno.env.get("RESEND_FROM_EMAIL") || "OwnerView <noreply@owner-view.com>",
          to: [to],
          subject,
          html,
        }),
      });
      if (!r.ok) {
        deliveryStatus = "failed";
        deliveryError = (await r.text().catch(() => "send failed")).slice(0, 500);
      }
    }

    await admin.from("company_join_requests").update({
      delivery_status: deliveryStatus,
      delivery_error: deliveryError,
      email_sent_at: deliveryStatus === "sent" ? new Date().toISOString() : null,
      last_result_email_type: rq.status,
    }).eq("id", requestId);

    if (deliveryStatus !== "sent") return j({ ok: false, delivery_status: deliveryStatus, error: "메일 발송에 실패했습니다." }, 502);
    return j({ ok: true, delivery_status: "sent" });
  } catch (_e) {
    return j({ error: "메일 처리 중 오류가 발생했습니다." }, 500);
  }
}));
