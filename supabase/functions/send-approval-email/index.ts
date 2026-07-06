import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// 2026-07-06 보안감사 P0: 하드코딩 Resend 키 제거 — env 로만. (노출된 키는 사장님이 Resend 대시보드에서 로테이션 필요)
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "OwnerView <noreply@owner-view.com>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ApprovalPayload {
  email: string;
  recipientName?: string;
  actionType: string;
  actionTitle: string;
  result: 'approved' | 'rejected';
  approverName?: string;
  comment?: string;
  dashboardUrl?: string;
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  payment: '결제', expense: '경비', document: '문서',
  leave: '휴가', signature: '서명', cost: '비용', approval: '결재',
};

function buildEmailHtml(p: ApprovalPayload): string {
  const typeLabel = ACTION_TYPE_LABELS[p.actionType] || p.actionType;
  const isApproved = p.result === 'approved';
  const statusColor = isApproved ? '#059669' : '#DC2626';
  const statusBg = isApproved ? '#ECFDF5' : '#FEF2F2';
  const statusIcon = isApproved ? '✅' : '❌';
  const statusText = isApproved ? '승인됨' : '반려됨';
  const greeting = p.recipientName ? `${p.recipientName}님` : '안녕하세요';
  const approver = p.approverName || '대표';
  const dashUrl = p.dashboardUrl || 'https://motiveinno-jpg.github.io/lean-os/dashboard';

  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Pretendard','Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 20px">
  <tr><td align="center">
    <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
      <tr><td style="background:#0F172A;padding:28px 32px;text-align:center">
        <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:1px">OwnerView</span>
      </td></tr>
      <tr><td style="padding:32px">
        <h2 style="margin:0 0 8px;font-size:20px;color:#1a1a2e">${greeting},</h2>
        <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6">
          요청하신 <strong>${typeLabel}</strong> 건의 처리 결과를 알려드립니다.
        </p>
        <div style="background:${statusBg};border-radius:12px;padding:20px;margin-bottom:24px">
          <div style="font-size:24px;margin-bottom:8px">${statusIcon}</div>
          <div style="font-size:18px;font-weight:700;color:${statusColor};margin-bottom:4px">${statusText}</div>
          <div style="font-size:14px;color:#374151;font-weight:600">${p.actionTitle}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px">승인자: ${approver}</div>
          ${p.comment ? `<div style="font-size:12px;color:#6b7280;margin-top:8px;padding-top:8px;border-top:1px solid ${isApproved ? '#D1FAE5' : '#FECACA'}">사유: ${p.comment}</div>` : ''}
        </div>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td align="center" style="padding:8px 0 24px">
            <a href="${dashUrl}" target="_blank" style="display:inline-block;padding:14px 40px;background:#2563EB;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;border-radius:10px">OwnerView에서 확인하기</a>
          </td></tr>
        </table>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
        <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.5">
          본 이메일은 OwnerView에서 자동 발송되었습니다.
        </p>
      </td></tr>
    </table>
    <p style="margin:16px 0 0;font-size:11px;color:#9ca3af;text-align:center">&copy; 2026 OwnerView by MOTIVE INNOVATION</p>
  </td></tr>
</table>
</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  try {
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");
    const payload: ApprovalPayload = await req.json();
    if (!payload.email || !payload.actionType || !payload.actionTitle || !payload.result) {
      throw new Error("Missing required fields");
    }
    const html = buildEmailHtml(payload);
    const resultLabel = payload.result === 'approved' ? '승인' : '반려';
    const typeLabel = ACTION_TYPE_LABELS[payload.actionType] || payload.actionType;
    const subject = `[OwnerView] ${typeLabel} ${resultLabel}: ${payload.actionTitle}`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: FROM_EMAIL, to: [payload.email], subject, html }),
    });
    const data = await res.json();
    if (!res.ok) { console.error("Resend error:", data); throw new Error(data.message || "Failed"); }
    return new Response(JSON.stringify({ success: true, id: data.id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("send-approval-email error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
