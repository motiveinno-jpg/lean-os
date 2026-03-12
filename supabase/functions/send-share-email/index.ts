// supabase/functions/send-share-email/index.ts
// 문서 공유 이메일 발송 Edge Function

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "noreply@owner-view.com";

interface ShareEmailRequest {
  email: string;
  recipientName?: string;
  documentName: string;
  shareUrl: string;
  senderName?: string;
  companyName?: string;
  message?: string;
}

function buildShareHtml(data: ShareEmailRequest): string {
  const company = data.companyName || "OwnerView";
  const sender = data.senderName || company;
  const recipient = data.recipientName || "담당자";

  return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;padding:20px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <div style="background:#3B82F6;color:#fff;padding:24px 28px;">
      <h1 style="margin:0;font-size:18px;">${company}</h1>
      <p style="margin:6px 0 0;font-size:13px;opacity:0.85;">문서 검토 요청</p>
    </div>
    <div style="padding:24px 28px;">
      <p style="font-size:14px;color:#333;margin:0 0 16px;">
        ${recipient}님 안녕하세요.<br>
        ${sender}입니다.
      </p>
      <p style="font-size:14px;color:#333;margin:0 0 20px;">
        <strong>${data.documentName}</strong>을(를) 보내드립니다.<br>
        아래 버튼을 눌러 문서를 확인하시고 검토 부탁드립니다.
      </p>

      ${data.message ? `
      <div style="margin:0 0 20px;padding:14px;background:#f8fafc;border-radius:10px;border-left:3px solid #3B82F6;">
        <div style="font-size:11px;color:#64748b;margin-bottom:4px;">메시지</div>
        <div style="font-size:13px;color:#334155;">${data.message.replace(/\n/g, "<br>")}</div>
      </div>
      ` : ""}

      <div style="text-align:center;margin:24px 0;">
        <a href="${data.shareUrl}" style="display:inline-block;padding:14px 36px;background:#3B82F6;color:#fff;text-decoration:none;border-radius:12px;font-size:14px;font-weight:600;">
          문서 확인하기
        </a>
      </div>

      <p style="font-size:11px;color:#94a3b8;text-align:center;margin:20px 0 0;">
        버튼이 동작하지 않으면 아래 링크를 복사해 브라우저에 붙여넣으세요.<br>
        <a href="${data.shareUrl}" style="color:#3B82F6;word-break:break-all;">${data.shareUrl}</a>
      </p>
    </div>
    <div style="background:#f8fafc;padding:14px 28px;">
      <table style="width:100%;font-size:11px;color:#94a3b8;">
        <tr>
          <td>${company}</td>
          <td style="text-align:right;">Powered by <strong>OwnerView</strong></td>
        </tr>
      </table>
    </div>
  </div>
</body></html>`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "인증 필요" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify user
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "인증 실패" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data: ShareEmailRequest = await req.json();

    if (!data.email || !data.documentName || !data.shareUrl) {
      return new Response(JSON.stringify({ error: "필수 정보 누락 (email, documentName, shareUrl)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const company = data.companyName || "OwnerView";
    const subject = `[${company}] ${data.documentName} 검토 요청`;
    const html = buildShareHtml(data);

    // Send via Resend API
    if (RESEND_API_KEY) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: `${company} <${FROM_EMAIL}>`,
          to: [data.email],
          subject,
          html,
        }),
      });

      if (res.ok) {
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const err = await res.text();
      console.error("Resend error:", err);
    }

    // Fallback
    return new Response(
      JSON.stringify({ success: false, fallback: true, subject, html }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
