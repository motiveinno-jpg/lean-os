import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const kakaoApiKey = Deno.env.get("KAKAO_ALIMTALK_API_KEY");
const kakaoSenderId = Deno.env.get("KAKAO_SENDER_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface AlimtalkPayload {
  template_code: string;
  recipient_phone: string;
  variables: Record<string, string>;
  company_id?: string;
}

const TEMPLATE_CODES: Record<string, { title: string; body: string }> = {
  approval_request: {
    title: "결재 요청",
    body: "#{company_name} #{approver_name}님, #{requester_name}님이 #{action_type} 건(#{action_title})의 결재를 요청했습니다. 오너뷰에서 확인해주세요.",
  },
  approval_result: {
    title: "결재 결과",
    body: "#{company_name} #{recipient_name}님, #{action_type} 건(#{action_title})이 #{result}되었습니다.",
  },
  payslip_ready: {
    title: "급여명세서",
    body: "#{company_name} #{employee_name}님, #{month}월 급여명세서가 발급되었습니다. 오너뷰에서 확인해주세요.",
  },
  contract_sign: {
    title: "전자계약 서명 요청",
    body: "#{company_name}에서 #{contract_title} 서명을 요청했습니다. 오너뷰에서 확인 후 서명해주세요.",
  },
  tax_invoice: {
    title: "세금계산서 발행",
    body: "#{company_name}에서 #{invoice_title} 세금계산서를 발행했습니다. 공급가액 #{amount}원.",
  },
  expense_approved: {
    title: "경비 승인",
    body: "#{company_name} #{recipient_name}님, #{expense_title} 경비 #{amount}원이 승인되었습니다.",
  },
};

function renderTemplate(templateCode: string, variables: Record<string, string>): { title: string; body: string } | null {
  const tmpl = TEMPLATE_CODES[templateCode];
  if (!tmpl) return null;
  let body = tmpl.body;
  for (const [key, value] of Object.entries(variables)) {
    body = body.replaceAll(`#{${key}}`, value);
  }
  return { title: tmpl.title, body };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceKey);
    const payload: AlimtalkPayload = await req.json();

    if (!payload.template_code || !payload.recipient_phone) {
      return new Response(JSON.stringify({ error: "template_code and recipient_phone required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rendered = renderTemplate(payload.template_code, payload.variables || {});
    if (!rendered) {
      return new Response(JSON.stringify({ error: `Unknown template: ${payload.template_code}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = false;
    let kakaoMessageId: string | null = null;

    if (kakaoApiKey && kakaoSenderId) {
      const kakaoRes = await fetch("https://api-alimtalk.cloud.toast.com/alimtalk/v2.3/appkeys/" + kakaoApiKey + "/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json;charset=UTF-8" },
        body: JSON.stringify({
          senderKey: kakaoSenderId,
          templateCode: payload.template_code,
          recipientList: [{
            recipientNo: payload.recipient_phone.replace(/[^0-9]/g, ""),
            templateParameter: payload.variables,
          }],
        }),
      });

      if (kakaoRes.ok) {
        const kakaoData = await kakaoRes.json();
        sent = kakaoData.header?.isSuccessful === true;
        kakaoMessageId = kakaoData.message?.requestId || null;
      }
    }

    await supabase.from("notification_logs").insert({
      company_id: payload.company_id || null,
      channel: "kakao_alimtalk",
      template_code: payload.template_code,
      recipient: payload.recipient_phone,
      title: rendered.title,
      body: rendered.body,
      status: sent ? "sent" : kakaoApiKey ? "failed" : "skipped",
      external_id: kakaoMessageId,
      metadata: { variables: payload.variables },
    }).then(() => {}, () => {});

    return new Response(JSON.stringify({
      success: true,
      sent,
      title: rendered.title,
      message: sent ? "알림톡 발송 완료" : kakaoApiKey ? "발송 실패" : "카카오 API 미설정 — 로그만 기록됨",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
