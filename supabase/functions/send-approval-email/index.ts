import { tfetch } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";
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
  // 결과 통보(기존) — 승인/반려
  result?: 'approved' | 'rejected';
  approverName?: string;
  comment?: string;
  dashboardUrl?: string;
  // 요청 도착 통보(2026-08-06 추가) — result 대신 kind 가 오면 이 경로
  kind?: 'requested' | 'stage_advanced' | 'reassigned' | 'reference';
  kindLabel?: string;
  // 수신자의 auth uid — 수신 거부 판정과 수신 주소 재정의를 서버에서 처리한다.
  //   notification_prefs 는 RLS 로 본인 것만 읽히므로 브라우저에서는 판정할 수 없다(2026-08-06).
  recipientAuthId?: string;
  requesterName?: string;
  amount?: number;
  stage?: number;
  totalStages?: number;
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  payment: '결제', expense: '경비', document: '문서',
  leave: '휴가', signature: '서명', cost: '비용', approval: '결재',
};

// 호출자 사용자 JWT 검증 — anon 키만으로는 통과 못 함(오픈 이메일 릴레이 차단).
async function verifyUser(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!token || !url || !anon) return false;
  try {
    const res = await tfetch(`${url}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anon },
    });
    if (!res.ok) return false;
    const u = await res.json();
    return !!u?.id;
  } catch {
    return false;
  }
}

// 수신 설정 조회 (service role) — 설정 > 알림에서 '결재 요청' 이메일을 끈 사람은 보내지 않는다.
//   행이 없거나 읽지 못하면 '받음'(설정 화면 기본값과 동일).
async function loadMailPref(authId?: string, kind?: string): Promise<{ send: boolean; address?: string }> {
  if (!authId) return { send: true };
  const url = Deno.env.get("SUPABASE_URL");
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !svc) return { send: true };
  try {
    const res = await tfetch(
      `${url}/rest/v1/notification_prefs?select=prefs&user_id=eq.${encodeURIComponent(authId)}`,
      { headers: { apikey: svc, Authorization: `Bearer ${svc}` } },
    );
    if (!res.ok) return { send: true };
    const rows = await res.json();
    const prefs = rows?.[0]?.prefs;
    const email = prefs?.email;
    if (!email) return { send: true };
    // 참조 통보는 '결재 참조' 스위치를, 나머지(요청 도착·차례·승인자 지정)는 '결재 요청' 스위치를 따른다.
    //   설정에 그 키가 아직 없으면(구 버전 저장분) 받는 것으로 본다.
    const eventKey = kind === "reference" ? "approval_reference" : "approval_pending";
    const off = email.enabled === false || email?.events?.[eventKey] === false;
    const address = typeof email.address === "string" && email.address.includes("@") ? email.address.trim() : undefined;
    return { send: !off, address };
  } catch {
    return { send: true };
  }
}

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

const KIND_HEADLINE: Record<string, string> = {
  requested: '새 결재 요청이 도착했습니다',
  stage_advanced: '결재하실 차례입니다',
  reassigned: '승인자로 지정되었습니다',
  reference: '참조로 공유된 결재 건입니다',
};

// 결재 요청 도착 메일 — 결과 메일과 톤을 맞추되, 행동을 요구하는 문구로.
function buildRequestEmailHtml(p: ApprovalPayload): string {
  const typeLabel = ACTION_TYPE_LABELS[p.actionType] || p.actionType;
  const greeting = p.recipientName ? `${p.recipientName}님` : '안녕하세요';
  const headline = KIND_HEADLINE[p.kind || 'requested'] || KIND_HEADLINE.requested;
  const dashUrl = p.dashboardUrl || 'https://www.owner-view.com/approvals';
  const amountRow = p.amount && p.amount > 0
    ? `<div style="font-size:13px;color:#374151;margin-top:6px">금액: <strong>${Number(p.amount).toLocaleString('ko-KR')}원</strong></div>`
    : '';
  const requesterRow = p.requesterName
    ? `<div style="font-size:12px;color:#6b7280;margin-top:4px">요청자: ${p.requesterName}</div>`
    : '';
  const stageRow = p.stage && p.totalStages && p.totalStages > 1
    ? `<div style="font-size:12px;color:#6b7280;margin-top:4px">단계: ${p.stage}/${p.totalStages}</div>`
    : '';
  const isReference = p.kind === 'reference';
  const cta = isReference ? '내용 확인하기' : '결재하러 가기';

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
        <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6">${headline}</p>
        <div style="background:#EFF6FF;border-radius:12px;padding:20px;margin-bottom:24px">
          <div style="font-size:12px;color:#2563EB;font-weight:700;margin-bottom:6px">${typeLabel}</div>
          <div style="font-size:16px;color:#111827;font-weight:700">${p.actionTitle}</div>
          ${amountRow}
          ${requesterRow}
          ${stageRow}
        </div>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td align="center" style="padding:8px 0 24px">
            <a href="${dashUrl}" target="_blank" style="display:inline-block;padding:14px 40px;background:#2563EB;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;border-radius:10px">${cta}</a>
          </td></tr>
        </table>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
        <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.5">
          본 이메일은 OwnerView에서 자동 발송되었습니다.<br>
          받고 싶지 않으시면 설정 &gt; 알림에서 '결재 요청' 이메일을 끄실 수 있습니다.
        </p>
      </td></tr>
    </table>
    <p style="margin:16px 0 0;font-size:11px;color:#9ca3af;text-align:center">&copy; 2026 OwnerView by MOTIVE INNOVATION</p>
  </td></tr>
</table>
</body>
</html>`;
}

Deno.serve(withSentry("send-approval-email", async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  try {
    if (!(await verifyUser(req))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");
    const payload: ApprovalPayload = await req.json();
    if (!payload.email || !payload.actionType || !payload.actionTitle) {
      throw new Error("Missing required fields");
    }
    if (!payload.result && !payload.kind) {
      throw new Error("Missing required fields");
    }
    // 요청 도착 메일만 수신 설정을 따른다(결과 통보는 요청자 본인에게 가는 것이라 종전대로).
    let toAddress = payload.email;
    if (payload.kind) {
      const pref = await loadMailPref(payload.recipientAuthId, payload.kind);
      if (!pref.send) {
        return new Response(JSON.stringify({ success: true, skipped: "opted_out" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (pref.address) toAddress = pref.address;
    }
    const typeLabel = ACTION_TYPE_LABELS[payload.actionType] || payload.actionType;
    // kind 가 오면 '요청 도착' 메일, 아니면 종전 '결과 통보' 메일 (기존 호출부 무변경)
    const html = payload.kind ? buildRequestEmailHtml(payload) : buildEmailHtml(payload);
    const subject = payload.kind
      ? `[OwnerView] ${payload.kindLabel || '결재 요청'}: ${payload.actionTitle}`
      : `[OwnerView] ${typeLabel} ${payload.result === 'approved' ? '승인' : '반려'}: ${payload.actionTitle}`;
    const res = await tfetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: FROM_EMAIL, to: [toAddress], subject, html }),
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
}));
