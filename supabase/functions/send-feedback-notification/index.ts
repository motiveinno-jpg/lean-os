import { withSentry } from "../_shared/sentry.ts";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 호출자 사용자 JWT 검증 — anon 키만으로는 통과 못 함(오픈 이메일 릴레이 차단).
async function verifyUser(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!token || !url || !anon) return false;
  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anon },
    });
    if (!res.ok) return false;
    const u = await res.json();
    return !!u?.id;
  } catch {
    return false;
  }
}

serve(withSentry("send-feedback-notification", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!(await verifyUser(req))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { to, documentName, feedbackFrom, decision, comment, companyName, viewUrl } = await req.json();

    if (!to || !documentName || !decision) {
      return new Response(
        JSON.stringify({ error: "to, documentName, decision required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const decisionLabel: Record<string, { text: string; color: string; emoji: string }> = {
      approved: { text: "승인", color: "#16a34a", emoji: "✅" },
      rejected: { text: "거부", color: "#dc2626", emoji: "❌" },
      hold: { text: "보류", color: "#d97706", emoji: "⏸️" },
    };
    const d = decisionLabel[decision] || { text: decision, color: "#6b7280", emoji: "📋" };

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
      <div style="background:#1a1a2e;color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="margin:0;font-size:20px">${companyName || "OwnerView"}</h1>
        <p style="margin:8px 0 0;opacity:0.8;font-size:14px">문서 피드백 알림</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px">
        <div style="text-align:center;margin:0 0 20px">
          <span style="font-size:40px">${d.emoji}</span>
          <h2 style="margin:8px 0 0;font-size:18px;color:${d.color}">${d.text}</h2>
        </div>
        <div style="background:#f3f4f6;border-radius:8px;padding:16px;margin:16px 0">
          <p style="margin:0 0 8px;font-size:14px;font-weight:bold">📄 ${documentName}</p>
          <p style="margin:0;font-size:13px;color:#6b7280">응답자: ${feedbackFrom || "외부 수신자"}</p>
          ${comment ? `<p style="margin:8px 0 0;font-size:13px;color:#374151;border-top:1px solid #e5e7eb;padding-top:8px">"${comment}"</p>` : ""}
        </div>
        ${viewUrl ? `<div style="text-align:center;margin:24px 0"><a href="${viewUrl}" style="display:inline-block;background:#3B82F6;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:bold;font-size:14px">딜 상세 보기</a></div>` : ""}
        <p style="font-size:12px;color:#9ca3af;text-align:center;margin:16px 0 0">본 이메일은 자동 발송되었습니다.</p>
      </div>
    </body></html>`;

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(
        JSON.stringify({ success: true, fallback: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: Deno.env.get("RESEND_FROM_EMAIL") || "OwnerView <noreply@owner-view.com>",
        to: [to],
        subject: `[${companyName || "OwnerView"}] "${documentName}" ${d.text} 피드백`,
        html,
      }),
    });

    if (emailRes.ok) {
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } else {
      const errText = await emailRes.text();
      return new Response(
        JSON.stringify({ success: false, error: errText }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
}));
