// supabase/functions/send-payslip-email/index.ts
// 급여명세서 이메일 발송 Edge Function

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "noreply@owner-view.com";

interface PayslipEmailRequest {
  recipientEmail: string;
  recipientName: string;
  companyName: string;
  payPeriod: string; // e.g. "2026년 3월"
  basePay: number;
  overtimePay: number;
  totalDeductions: number;
  netPay: number;
  deductionDetails?: {
    nationalPension: number;
    healthInsurance: number;
    longTermCare: number;
    employmentInsurance: number;
    incomeTax: number;
    localIncomeTax: number;
  };
}

function formatAmount(n: number): string {
  return n.toLocaleString("ko-KR");
}

function buildPayslipHtml(data: PayslipEmailRequest): string {
  const d = data.deductionDetails;
  return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;padding:20px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <div style="background:#3B82F6;color:#fff;padding:24px 28px;">
      <h1 style="margin:0;font-size:18px;">${data.companyName}</h1>
      <p style="margin:6px 0 0;font-size:13px;opacity:0.85;">${data.payPeriod} 급여명세서</p>
    </div>
    <div style="padding:24px 28px;">
      <p style="font-size:14px;color:#333;margin:0 0 20px;">${data.recipientName}님, 안녕하세요.<br>${data.payPeriod} 급여명세서를 안내드립니다.</p>

      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="background:#f8fafc;">
          <td style="padding:10px 14px;color:#64748b;border-bottom:1px solid #e2e8f0;">기본급</td>
          <td style="padding:10px 14px;text-align:right;font-weight:600;border-bottom:1px solid #e2e8f0;">₩${formatAmount(data.basePay)}</td>
        </tr>
        <tr>
          <td style="padding:10px 14px;color:#64748b;border-bottom:1px solid #e2e8f0;">연장근로수당</td>
          <td style="padding:10px 14px;text-align:right;font-weight:600;border-bottom:1px solid #e2e8f0;">₩${formatAmount(data.overtimePay)}</td>
        </tr>
        <tr style="background:#f8fafc;">
          <td style="padding:10px 14px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">지급 합계</td>
          <td style="padding:10px 14px;text-align:right;font-weight:700;color:#1e40af;border-bottom:1px solid #e2e8f0;">₩${formatAmount(data.basePay + data.overtimePay)}</td>
        </tr>
      </table>

      ${d ? `
      <h3 style="font-size:13px;color:#64748b;margin:20px 0 8px;">공제 내역</h3>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <tr><td style="padding:6px 14px;color:#94a3b8;">국민연금</td><td style="padding:6px 14px;text-align:right;">₩${formatAmount(d.nationalPension)}</td></tr>
        <tr style="background:#f8fafc;"><td style="padding:6px 14px;color:#94a3b8;">건강보험</td><td style="padding:6px 14px;text-align:right;">₩${formatAmount(d.healthInsurance)}</td></tr>
        <tr><td style="padding:6px 14px;color:#94a3b8;">장기요양</td><td style="padding:6px 14px;text-align:right;">₩${formatAmount(d.longTermCare)}</td></tr>
        <tr style="background:#f8fafc;"><td style="padding:6px 14px;color:#94a3b8;">고용보험</td><td style="padding:6px 14px;text-align:right;">₩${formatAmount(d.employmentInsurance)}</td></tr>
        <tr><td style="padding:6px 14px;color:#94a3b8;">소득세</td><td style="padding:6px 14px;text-align:right;">₩${formatAmount(d.incomeTax)}</td></tr>
        <tr style="background:#f8fafc;"><td style="padding:6px 14px;color:#94a3b8;">지방소득세</td><td style="padding:6px 14px;text-align:right;">₩${formatAmount(d.localIncomeTax)}</td></tr>
      </table>
      ` : ""}

      <div style="margin:20px 0;padding:16px;background:#eff6ff;border-radius:12px;text-align:center;">
        <div style="font-size:12px;color:#64748b;">공제 합계: ₩${formatAmount(data.totalDeductions)}</div>
        <div style="font-size:22px;font-weight:800;color:#1e40af;margin-top:4px;">실수령액 ₩${formatAmount(data.netPay)}</div>
      </div>

      <p style="font-size:11px;color:#94a3b8;margin:16px 0 0;">본 메일은 ${data.companyName}에서 OwnerView를 통해 자동 발송되었습니다.<br>문의사항은 인사담당자에게 연락해주세요.</p>
    </div>
    <div style="background:#f8fafc;padding:14px 28px;text-align:center;font-size:11px;color:#94a3b8;">
      Powered by <strong>OwnerView</strong>
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

    const data: PayslipEmailRequest = await req.json();

    if (!data.recipientEmail || !data.recipientName) {
      return new Response(JSON.stringify({ error: "수신자 정보 필수" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const html = buildPayslipHtml(data);
    const subject = `[${data.companyName}] ${data.payPeriod} 급여명세서`;

    // Send via Resend API
    if (RESEND_API_KEY) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: `${data.companyName} <${FROM_EMAIL}>`,
          to: [data.recipientEmail],
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

    // Fallback: return HTML for client-side handling
    return new Response(
      JSON.stringify({ success: false, fallback: true, html, subject }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
