// 세무사 파트너 알림 메일 (2026-08-12 사장님: 가입·승인·연결이 전부 무통보였다)
//   이벤트 4종 — registered(가입→운영자), approved(승인→세무사),
//   linked/unlinked(회사 연결·해제→세무사). 클라이언트가 RPC 성공 후 베스트에포트로
//   호출한다(실패해도 본 동작에는 영향 없음). 수신자·내용은 서버가 service role 로
//   직접 조회해 결정 — 클라이언트가 보낸 이메일 주소를 그대로 믿지 않는다.
import { tfetch } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 플랫폼 운영자 수신함 — platform 레이아웃 OPERATOR_EMAILS 와 동일 기준(운영자 확대 시 함께 변경).
const OPERATOR_EMAIL = "creative@mo-tive.com";
const SITE = "https://www.owner-view.com";

function mailHtml(title: string, body: string, ctaLabel?: string, ctaUrl?: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#212836">
    <div style="background:#17233f;color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center">
      <h1 style="margin:0;font-size:18px">오너뷰 파트너</h1>
      <p style="margin:8px 0 0;color:#d9c493;font-size:11px;letter-spacing:.2em">OWNERVIEW PARTNERS</p>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px">
      <p style="font-size:16px;font-weight:bold;margin:0 0 12px">${title}</p>
      <p style="font-size:14px;line-height:1.7;margin:0;color:#4b5563">${body}</p>
      ${ctaUrl ? `<div style="text-align:center;margin:24px 0 8px"><a href="${ctaUrl}" style="display:inline-block;background:#17233f;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:bold;font-size:14px">${ctaLabel}</a></div>` : ""}
      <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;text-align:center">본 이메일은 자동 발송되었습니다.</p>
    </div>
  </body></html>`;
}

async function sendMail(to: string, subject: string, html: string): Promise<boolean> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return false;
  const res = await tfetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from: Deno.env.get("RESEND_FROM_EMAIL") || "OwnerView <noreply@owner-view.com>",
      to: [to],
      subject,
      html,
    }),
  });
  return res.ok;
}

serve(withSentry("advisor-notify", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { event, advisor_id } = await req.json();
    const callerEmail = (user.email || "").toLowerCase();
    const isOperator = callerEmail === OPERATOR_EMAIL;

    if (event === "registered") {
      // 가입자는 본인 — advisor 행을 auth_id 로 찾는다 (클라이언트 인자를 안 믿음)
      const { data: adv } = await admin.from("tax_advisors")
        .select("name, office_name, email, phone, specialty").eq("auth_id", user.id).maybeSingle();
      if (!adv) return json({ error: "advisor not found" }, 404);
      const ok = await sendMail(
        OPERATOR_EMAIL,
        `[오너뷰] 세무사 파트너 가입 — ${adv.name}${adv.office_name ? ` (${adv.office_name})` : ""}`,
        mailHtml(
          "새 세무사 파트너가 가입했습니다",
          `${adv.name}${adv.office_name ? ` · ${adv.office_name}` : ""}<br/>${adv.email}${adv.phone ? ` · ${adv.phone}` : ""}${adv.specialty ? `<br/>전문 분야: ${adv.specialty}` : ""}<br/><br/>운영자 페이지에서 확인 후 승인해 주세요.`,
          "승인하러 가기", `${SITE}/platform/advisors`,
        ),
      );
      return json({ success: ok });
    }

    if (event === "approved") {
      if (!isOperator) return json({ error: "forbidden" }, 403);
      const { data: adv } = await admin.from("tax_advisors")
        .select("name, email").eq("id", advisor_id).maybeSingle();
      if (!adv?.email) return json({ error: "advisor not found" }, 404);
      const ok = await sendMail(
        adv.email,
        "[오너뷰] 파트너 승인이 완료되었습니다",
        mailHtml(
          `${adv.name} 세무사님, 파트너 승인이 완료되었습니다`,
          "이제 파트너 포털에 로그인하실 수 있습니다. 고객사가 연결되는 대로 통장·세금계산서·인건비 지면이 열립니다.",
          "파트너 포털 로그인", `${SITE}/advisor`,
        ),
      );
      return json({ success: ok });
    }

    if (event === "linked" || event === "unlinked") {
      // 호출자 검증: 운영자이거나, 그 세무사와 "활성/방금 해제된 링크"가 있는 회사의 구성원.
      const { data: adv } = await admin.from("tax_advisors")
        .select("id, name, email").eq("id", advisor_id).maybeSingle();
      if (!adv?.email) return json({ error: "advisor not found" }, 404);
      let companyName = "";
      if (!isOperator) {
        const { data: caller } = await admin.from("users")
          .select("company_id, companies(name)").eq("auth_id", user.id).maybeSingle();
        if (!caller?.company_id) return json({ error: "forbidden" }, 403);
        const { data: link } = await admin.from("advisor_company_links")
          .select("id").eq("advisor_id", advisor_id).eq("company_id", caller.company_id).maybeSingle();
        if (!link) return json({ error: "forbidden" }, 403);
        companyName = (caller as { companies?: { name?: string } }).companies?.name || "";
      } else {
        // 운영자 경로 — 가장 최근 상태 변경 링크의 회사명
        const { data: link } = await admin.from("advisor_company_links")
          .select("company_id, companies(name)").eq("advisor_id", advisor_id)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        companyName = (link as { companies?: { name?: string } } | null)?.companies?.name || "";
      }
      const linked = event === "linked";
      const ok = await sendMail(
        adv.email,
        linked
          ? `[오너뷰] ${companyName || "고객사"} 연결 — 열람이 시작되었습니다`
          : `[오너뷰] ${companyName || "고객사"} 연결이 해제되었습니다`,
        mailHtml(
          linked
            ? `${companyName || "고객사"}가 세무사님과 연결되었습니다`
            : `${companyName || "고객사"} 연결이 해제되었습니다`,
          linked
            ? "파트너 포털에서 해당 회사의 장부를 바로 열람하실 수 있습니다."
            : "해당 회사의 데이터 열람이 종료되었습니다. 오류라면 회사 담당자에게 문의해 주세요.",
          linked ? "고객사 열람하기" : undefined,
          linked ? `${SITE}/advisor/dashboard` : undefined,
        ),
      );
      return json({ success: ok });
    }

    return json({ error: "unknown event" }, 400);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
}));
