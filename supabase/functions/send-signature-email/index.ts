import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { to, signerName, title, signUrl, expiresAt, companyName } = await req.json();

    if (!to || !title || !signUrl) {
      return new Response(
        JSON.stringify({ error: "to, title, signUrl required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const expiryText = expiresAt
      ? new Date(expiresAt).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })
      : "14일 후";

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
      <div style="background:#1a1a2e;color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="margin:0;font-size:20px">${companyName || "OwnerView"}</h1>
        <p style="margin:8px 0 0;opacity:0.8;font-size:14px">전자서명 요청</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px">
        <p style="font-size:15px;margin:0 0 12px">안녕하세요 <strong>${signerName || "담당자"}</strong>님,</p>
        <p style="font-size:14px;color:#6b7280;margin:0 0 20px">아래 문서에 대한 전자서명이 요청되었습니다.</p>
        <div style="background:#f3f4f6;border-radius:8px;padding:16px;margin:16px 0">
          <p style="margin:0;font-size:14px;font-weight:bold">✍️ ${title}</p>
          <p style="margin:8px 0 0;font-size:12px;color:#9ca3af">서명 기한: ${expiryText}</p>
        </div>
        <div style="text-align:center;margin:24px 0">
          <a href="${signUrl}" style="display:inline-block;background:#7C3AED;color:#fff;text-decoration:none;padding:14px 40px;border-radius:8px;font-weight:bold;font-size:14px">문서 확인 및 서명하기</a>
        </div>
        <p style="font-size:12px;color:#9ca3af;text-align:center;margin:16px 0 0">서명 기한이 지나면 링크가 만료됩니다.<br>본 이메일은 자동 발송되었습니다.</p>
      </div>
    </body></html>`;

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(
        JSON.stringify({ success: true, fallback: true, signUrl }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: Deno.env.get("RESEND_FROM_EMAIL") || "noreply@ownerview.app",
        to: [to],
        subject: `[${companyName || "OwnerView"}] "${title}" 전자서명 요청`,
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
});
