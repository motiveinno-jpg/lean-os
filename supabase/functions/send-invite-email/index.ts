import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { email, name, role, inviteUrl, companyName } = await req.json();

    if (!email || !inviteUrl) {
      return new Response(
        JSON.stringify({ error: "email, inviteUrl required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const roleLabel: Record<string, string> = {
      admin: "관리자",
      manager: "매니저",
      staff: "일반 직원",
      accountant: "회계 담당자",
      viewer: "열람자",
      partner: "파트너",
    };
    const displayRole = roleLabel[role] || role || "팀원";
    const displayName = name || email.split("@")[0];
    const displayCompany = companyName || "OwnerView";

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
      <div style="background:#1a1a2e;color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="margin:0;font-size:20px">${displayCompany}</h1>
        <p style="margin:8px 0 0;opacity:0.8;font-size:14px">팀 초대</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px">
        <h2 style="margin:0 0 16px;font-size:18px;color:#1a1a2e">안녕하세요, ${displayName}님!</h2>
        <p style="font-size:14px;color:#374151;line-height:1.6">
          <strong>${displayCompany}</strong>에서 <strong>${displayRole}</strong> 역할로 초대합니다.
          아래 버튼을 클릭하여 가입을 완료하세요.
        </p>
        <div style="text-align:center;margin:24px 0">
          <a href="${inviteUrl}" style="display:inline-block;background:#3B82F6;color:#fff;text-decoration:none;padding:14px 40px;border-radius:8px;font-weight:bold;font-size:15px">초대 수락하기</a>
        </div>
        <p style="font-size:12px;color:#9ca3af;text-align:center">
          버튼이 작동하지 않으면 아래 링크를 브라우저에 직접 붙여넣으세요:<br/>
          <a href="${inviteUrl}" style="color:#3B82F6;word-break:break-all">${inviteUrl}</a>
        </p>
        <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb">
          <p style="font-size:11px;color:#9ca3af;text-align:center;margin:0">
            이 초대는 7일간 유효합니다. 본인이 요청하지 않았다면 이 이메일을 무시하세요.
          </p>
        </div>
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
        from: Deno.env.get("RESEND_FROM_EMAIL") || "noreply@ownerview.app",
        to: [email],
        subject: `[${displayCompany}] ${displayName}님, 팀에 초대합니다`,
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
