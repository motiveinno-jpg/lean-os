import { tfetch } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 2026-05-22 메일 본문에서 급여 금액 전부 제거 — 금액은 비밀번호 보호 PDF 첨부에만.
//   본문은 수령 안내 + 비밀번호 안내만. (본문에 금액이 보이면 PDF 비번 의미가 없어짐)
function buildPayslipHTML(data: any): string {
  const pwdNote = data.hasPassword
    ? `<p style="margin:18px 0 0;padding:12px 14px;background:#fff7ed;border:1px solid #fdba74;border-radius:8px;font-size:13px;color:#9a3412;line-height:1.6">
        🔒 첨부된 급여명세서 PDF 는 <b>비밀번호로 보호</b>되어 있습니다.<br/>
        비밀번호: <b>본인 생년월일 8자리 (YYYYMMDD)</b><br/>
        <span style="color:#b45309;font-size:12px">예) 1990년 3월 5일생 → 19900305</span>
      </p>`
    : `<p style="margin:18px 0 0;padding:12px 14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;color:#6b7280;line-height:1.6">
        📎 급여명세서 PDF 를 첨부합니다.
      </p>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
    <div style="background:#1a1a2e;color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center">
      <h1 style="margin:0;font-size:20px">${data.companyName}</h1>
      <p style="margin:8px 0 0;opacity:0.8;font-size:14px">${data.monthLabel} 급여명세서</p>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px">
      <p style="font-size:16px;font-weight:bold;margin:0 0 12px">${data.employeeName}님</p>
      <p style="font-size:14px;color:#374151;line-height:1.7;margin:0">
        ${data.monthLabel} 급여명세서를 첨부 PDF 로 보내드립니다.<br/>
        자세한 지급·공제 내역은 첨부된 명세서를 확인해 주세요.
      </p>
      ${pwdNote}
      <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;text-align:center">본 메일은 자동 발송되었습니다. 문의사항은 인사팀으로 연락해주세요.</p>
    </div>
  </body></html>`;
}

serve(withSentry("send-payslip-email", async (req) => {
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

    const data = await req.json();
    const html = buildPayslipHTML(data);

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ success: true, fallback: true, html }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // PDF 첨부 (비밀번호 걸린 명세서)
    const attachments: any[] = [];
    if (data.pdfBase64 && data.pdfFilename) {
      attachments.push({
        filename: data.pdfFilename,
        content: data.pdfBase64, // base64 string — Resend 가 자동 디코드
      });
    }

    const emailRes = await tfetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: Deno.env.get("RESEND_FROM_EMAIL") || "OwnerView <noreply@owner-view.com>",
        to: [data.email],
        subject: `[${data.companyName}] ${data.monthLabel} 급여명세서`,
        html,
        ...(attachments.length > 0 ? { attachments } : {}),
      }),
    });

    if (emailRes.ok) {
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } else {
      const err = await emailRes.text();
      return new Response(JSON.stringify({ success: false, error: err }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
}));
