import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function formatKRW(n: number): string {
  return new Intl.NumberFormat("ko-KR").format(n) + "원";
}

function buildPayslipHTML(data: any): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
    <div style="background:#1a1a2e;color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center">
      <h1 style="margin:0;font-size:20px">${data.companyName}</h1>
      <p style="margin:8px 0 0;opacity:0.8;font-size:14px">${data.monthLabel} 급여명세서</p>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px">
      <p style="font-size:16px;font-weight:bold;margin:0 0 16px">${data.employeeName}님</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr style="border-bottom:2px solid #1a1a2e"><th style="text-align:left;padding:8px">항목</th><th style="text-align:right;padding:8px">금액</th></tr>
        <tr style="background:#f9fafb"><td style="padding:8px">기본급</td><td style="text-align:right;padding:8px;font-weight:bold">${formatKRW(data.baseSalary)}</td></tr>
        <tr><td colspan="2" style="padding:12px 8px 4px;font-weight:bold;color:#dc2626;font-size:13px">공제내역</td></tr>
        <tr style="background:#fef2f2"><td style="padding:6px 8px;font-size:13px">국민연금</td><td style="text-align:right;padding:6px 8px;font-size:13px">-${formatKRW(data.nationalPension)}</td></tr>
        <tr style="background:#fef2f2"><td style="padding:6px 8px;font-size:13px">건강보험</td><td style="text-align:right;padding:6px 8px;font-size:13px">-${formatKRW(data.healthInsurance)}</td></tr>
        <tr style="background:#fef2f2"><td style="padding:6px 8px;font-size:13px">고용보험</td><td style="text-align:right;padding:6px 8px;font-size:13px">-${formatKRW(data.employmentInsurance)}</td></tr>
        <tr style="background:#fef2f2"><td style="padding:6px 8px;font-size:13px">소득세</td><td style="text-align:right;padding:6px 8px;font-size:13px">-${formatKRW(data.incomeTax)}</td></tr>
        <tr style="background:#fef2f2"><td style="padding:6px 8px;font-size:13px">지방소득세</td><td style="text-align:right;padding:6px 8px;font-size:13px">-${formatKRW(data.localIncomeTax)}</td></tr>
        <tr style="border-top:1px solid #e5e7eb"><td style="padding:8px;font-weight:bold">공제 합계</td><td style="text-align:right;padding:8px;font-weight:bold;color:#dc2626">-${formatKRW(data.deductionsTotal)}</td></tr>
        <tr style="background:#1a1a2e;color:#fff"><td style="padding:12px 8px;font-weight:bold;font-size:16px;border-radius:0 0 0 8px">실수령액</td><td style="text-align:right;padding:12px 8px;font-weight:bold;font-size:16px;border-radius:0 0 8px 0">${formatKRW(data.netPay)}</td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;text-align:center">본 명세서는 자동 발송되었습니다. 문의사항은 인사팀으로 연락해주세요.</p>
    </div>
  </body></html>`;
}

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

    const data = await req.json();
    const html = buildPayslipHTML(data);

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ success: true, fallback: true, html }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: Deno.env.get("RESEND_FROM_EMAIL") || "noreply@ownerview.app",
        to: [data.email],
        subject: `[${data.companyName}] ${data.monthLabel} 급여명세서`,
        html,
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
});
