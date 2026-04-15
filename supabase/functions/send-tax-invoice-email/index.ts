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
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const {
      recipientEmail,
      recipientName,
      senderCompany,
      invoiceNumber,
      issueDate,
      supplyAmount,
      taxAmount,
      totalAmount,
      counterpartyName,
      type,
      pdfBase64,
    } = await req.json();

    if (!recipientEmail || !invoiceNumber) {
      return new Response(JSON.stringify({ error: "recipientEmail and invoiceNumber required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const typeLabel = type === "sales" ? "매출" : "매입";
    const subject = `[${senderCompany || "OwnerView"}] 세금계산서 (${typeLabel}) - ${invoiceNumber}`;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#333;background:#f9fafb">
  <div style="background:#1a1a2e;color:#fff;padding:24px 28px;border-radius:12px 12px 0 0">
    <h1 style="margin:0;font-size:18px">${senderCompany || "OwnerView"}</h1>
    <p style="margin:6px 0 0;opacity:0.8;font-size:13px">세금계산서가 발행되었습니다</p>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:28px;background:#fff">
    <p style="font-size:14px;margin:0 0 16px">${recipientName || counterpartyName || "담당자"}님께,</p>
    <p style="font-size:14px;margin:0 0 20px;line-height:1.6">
      아래와 같이 세금계산서를 발행하였습니다.${pdfBase64 ? " 첨부된 PDF를 확인해 주세요." : ""}
    </p>

    <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:13px">
      <tr style="background:#f3f4f6">
        <td style="padding:10px 14px;font-weight:bold;border:1px solid #e5e7eb;width:120px">문서번호</td>
        <td style="padding:10px 14px;border:1px solid #e5e7eb">${invoiceNumber}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:bold;border:1px solid #e5e7eb;background:#f3f4f6">구분</td>
        <td style="padding:10px 14px;border:1px solid #e5e7eb">${typeLabel}</td>
      </tr>
      <tr style="background:#f3f4f6">
        <td style="padding:10px 14px;font-weight:bold;border:1px solid #e5e7eb">발행일</td>
        <td style="padding:10px 14px;border:1px solid #e5e7eb">${issueDate || "-"}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:bold;border:1px solid #e5e7eb;background:#f3f4f6">거래처</td>
        <td style="padding:10px 14px;border:1px solid #e5e7eb">${counterpartyName || "-"}</td>
      </tr>
      <tr style="background:#f3f4f6">
        <td style="padding:10px 14px;font-weight:bold;border:1px solid #e5e7eb">공급가액</td>
        <td style="padding:10px 14px;border:1px solid #e5e7eb">₩${Number(supplyAmount || 0).toLocaleString()}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;font-weight:bold;border:1px solid #e5e7eb;background:#f3f4f6">부가세</td>
        <td style="padding:10px 14px;border:1px solid #e5e7eb">₩${Number(taxAmount || 0).toLocaleString()}</td>
      </tr>
      <tr style="background:#3B82F6;color:#fff">
        <td style="padding:10px 14px;font-weight:bold;border:1px solid #3B82F6">합계금액</td>
        <td style="padding:10px 14px;border:1px solid #3B82F6;font-weight:bold;font-size:15px">₩${Number(totalAmount || 0).toLocaleString()}</td>
      </tr>
    </table>

    <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:12px 16px;margin:16px 0;font-size:12px;color:#92400e">
      ⚠️ 본 세금계산서는 참고용이며, 법적 효력이 있는 전자세금계산서는 국세청 홈택스(hometax.go.kr)를 통해 발행됩니다.
    </div>

    <p style="margin:20px 0 0;font-size:11px;color:#9ca3af;text-align:center">
      본 이메일은 ${senderCompany || "OwnerView"}에서 자동 발송되었습니다.
    </p>
  </div>
</body></html>`;

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ success: true, fallback: true, message: "RESEND_API_KEY 미설정. 이메일 미발송." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build email payload
    const emailPayload: Record<string, unknown> = {
      from: Deno.env.get("RESEND_FROM_EMAIL") || "noreply@ownerview.app",
      to: [recipientEmail],
      subject,
      html,
    };

    // Attach PDF if provided
    if (pdfBase64) {
      emailPayload.attachments = [
        {
          filename: `세금계산서_${invoiceNumber}.pdf`,
          content: pdfBase64,
        },
      ];
    }

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify(emailPayload),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      return new Response(JSON.stringify({ error: `이메일 발송 실패: ${errText}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const emailData = await emailRes.json();
    return new Response(JSON.stringify({ success: true, emailId: emailData.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
