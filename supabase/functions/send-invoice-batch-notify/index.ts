//   세금계산서 대량발행 요약 알림 — 대량발행 때 건별 알림(hometax-issue) 대신 요약 1건만.
//   수신자는 body 가 아니라 회사 설정(tax_settings.invoice_notify_email)에서 서버가 정한다(임의 주소 릴레이 차단).
import { tfetch } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";
import { resolveCaller, deny } from "../_shared/mail-guard.ts";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(withSentry("send-invoice-batch-notify", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const caller = await resolveCaller(req);
  if (!caller) return deny("회사에 소속된 계정만 보낼 수 있습니다.", 403, corsHeaders);

  const body = await req.json().catch(() => ({}));
  const issued = Math.max(0, Math.round(Number(body.issued) || 0));
  const failed = Math.max(0, Math.round(Number(body.failed) || 0));
  const supply = Math.round(Number(body.supply) || 0);
  const tax = Math.round(Number(body.tax) || 0);
  if (issued <= 0) {
    return new Response(JSON.stringify({ ok: true, sent: false, reason: "nothing issued" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data: company } = await supabase.from("companies").select("name, tax_settings").eq("id", caller.companyId).maybeSingle();
  const notifyEmail = String((company?.tax_settings as Record<string, unknown> | null)?.invoice_notify_email || "").trim();
  const resendKey = Deno.env.get("RESEND_API_KEY");
  // 알림 주소나 키가 없으면 조용히 넘어간다(설정 안 한 회사).
  if (!notifyEmail || !resendKey) {
    return new Response(JSON.stringify({ ok: true, sent: false }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
  const total = supply + tax;
  const today = new Date().toISOString().split("T")[0];
  const html = [
    `<div style="font-family:Apple SD Gothic Neo,Malgun Gothic,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1c2030">`,
    `<h2 style="font-size:17px;margin:0 0 4px">세금계산서 ${issued}건이 발행되었습니다</h2>`,
    `<p style="font-size:13px;color:#6b7080;margin:0 0 18px">${company?.name || ""} · ${today}${failed > 0 ? ` · 실패 ${failed}건은 '발행 대기'` : ""}</p>`,
    `<table style="width:100%;font-size:13.5px;border-collapse:collapse">`,
    `<tr><td style="padding:7px 0;color:#6b7080">발행 건수</td><td style="text-align:right;font-weight:700">${issued}건</td></tr>`,
    `<tr><td style="padding:7px 0;color:#6b7080">공급가액 합계</td><td style="text-align:right">${won(supply)}</td></tr>`,
    `<tr><td style="padding:7px 0;color:#6b7080">세액 합계</td><td style="text-align:right">${won(tax)}</td></tr>`,
    `<tr><td style="padding:7px 0;color:#6b7080;border-top:1px solid #e5e7ee">합계</td><td style="text-align:right;font-weight:800;border-top:1px solid #e5e7ee">${won(total)}</td></tr>`,
    `</table>`,
    `<a href="https://www.owner-view.com/tax-invoices" style="display:inline-block;margin-top:20px;padding:10px 18px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-size:13px">발행 내역 보기</a>`,
    `<p style="font-size:11px;color:#9aa0b0;margin-top:18px">이 알림은 설정 &gt; 은행연동 &gt; 홈택스의 발행 알림 주소로 발송되었습니다.</p>`,
    `</div>`,
  ].join("");

  try {
    await tfetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("RESEND_FROM_EMAIL") || "오너뷰 <noreply@owner-view.com>",
        to: [notifyEmail],
        subject: `[오너뷰] 세금계산서 ${issued}건 발행 완료 · 합계 ${won(total)}`,
        html,
      }),
    });
  } catch (_e) {
    return new Response(JSON.stringify({ ok: true, sent: false }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify({ ok: true, sent: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}));
