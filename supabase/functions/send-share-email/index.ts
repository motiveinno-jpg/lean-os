import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { email, documentName, sharedBy, companyName, shareUrl, message } = await req.json();

    if (!email || !documentName) {
      return new Response(JSON.stringify({ error: "email and documentName required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
      <div style="background:#1a1a2e;color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="margin:0;font-size:20px">${companyName || "OwnerView"}</h1>
        <p style="margin:8px 0 0;opacity:0.8;font-size:14px">문서가 공유되었습니다</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px">
        <p style="font-size:15px;margin:0 0 12px"><strong>${sharedBy || "동료"}</strong>님이 문서를 공유했습니다.</p>
        <div style="background:#f3f4f6;border-radius:8px;padding:16px;margin:16px 0">
          <p style="margin:0;font-size:14px;font-weight:bold">📄 ${documentName}</p>
          ${message ? `<p style="margin:8px 0 0;font-size:13px;color:#6b7280">${message}</p>` : ""}
        </div>
        ${shareUrl ? `<div style="text-align:center;margin:24px 0"><a href="${shareUrl}" style="display:inline-block;background:#3B82F6;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:bold;font-size:14px">문서 확인하기</a></div>` : ""}
        <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;text-align:center">본 이메일은 자동 발송되었습니다.</p>
      </div>
    </body></html>`;

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ success: true, fallback: true, html }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: Deno.env.get("RESEND_FROM_EMAIL") || "noreply@ownerview.app",
        to: [email],
        subject: `[${companyName || "OwnerView"}] ${sharedBy || "동료"}님이 "${documentName}" 문서를 공유했습니다`,
        html,
      }),
    });

    if (emailRes.ok) {
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } else {
      return new Response(JSON.stringify({ success: false, error: await emailRes.text() }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
