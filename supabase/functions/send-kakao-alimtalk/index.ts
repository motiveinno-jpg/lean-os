import { withSentry } from "../_shared/sentry.ts";
import { checkIngestSecret } from "../_shared/ingest-auth.ts";
import { ALIMTALK_TEMPLATES, isAlimtalkConfigured, sendAlimtalk, type AlimtalkTemplate } from "../_shared/alimtalk.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// 외부 자동화(n8n 등)에서 알림톡 한 통을 보내는 입구. 발송 자체는 _shared/alimtalk.ts 가 한다(앱 안의 결재·급여·계약도 같은 것을 쓴다).
//   공유 시크릿 게이트(2026-08-19 감사): 종전엔 인증이 전혀 없어 URL 만 알면 임의 번호로 회사명이 박힌 알림톡을 무제한 발송할 수 있었다.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, x-ingest-secret, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface AlimtalkPayload {
  template_code: string;
  recipient_phone: string;
  variables: Record<string, string>;
  company_id?: string;
}

Deno.serve(withSentry("send-kakao-alimtalk", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (!checkIngestSecret(req)) return json({ error: "Unauthorized (invalid or missing ingest secret)" }, 401);
    const payload: AlimtalkPayload = await req.json();
    if (!payload.template_code || !payload.recipient_phone) return json({ error: "template_code and recipient_phone required" }, 400);
    if (!(payload.template_code in ALIMTALK_TEMPLATES)) return json({ error: `Unknown template: ${payload.template_code}` }, 400);

    const r = await sendAlimtalk({
      companyId: payload.company_id || null,
      template: payload.template_code as AlimtalkTemplate,
      phone: payload.recipient_phone,
      variables: payload.variables || {},
      skipPrefCheck: true,   // 외부 호출은 번호를 직접 주므로 계정 설정을 볼 수 없다
    });
    // 발송 실패를 success:true 로 돌려주면 호출자가 성공으로 오인해 무음 전멸한다 (2026-08-19 감사).
    //   API 미설정(skipped)은 의도된 상태라 200, 실제 발송 실패는 502 + success:false.
    const failed = r.status === "failed";
    return json({
      success: !failed, sent: r.sent, status: r.status, reason: r.reason ?? null,
      message: r.sent ? "알림톡 발송 완료" : failed ? "발송 실패" : isAlimtalkConfigured() ? "보내지 않음" : "카카오 API 미설정 — 로그만 기록됨",
    }, failed ? 502 : 200);
  } catch (err: unknown) {
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
}));
