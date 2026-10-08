// send-issue-request-email — 세금계산서 발행 요청 메일을 공급자(거래처)에게 보낸다.
//
//   받는 사람은 회사 밖 주소다. 그래서 요청 본문의 주소·내용을 그대로 쓰지 않고
//   **호출자가 볼 수 있는 tax_invoice_requests 한 줄**(RLS: 우리 회사 + 세금계산서 권한)에서만 읽는다.
//   send-signature-email 이 서명 요청 행에 묶어 외부 서명자에게 보내는 것과 같은 방식.
//   버튼 링크는 우리 사이트(/issue-request?token=…)로만 만든다.
//
//   verify_jwt = true (로그인 사용자만)

import { tfetch } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";
import { escapeHtml, isAppUrl, resolveCaller, deny } from "../_shared/mail-guard.ts";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const esc = escapeHtml;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SITE = (Deno.env.get("SITE_URL") || "https://www.owner-view.com").replace(/\/$/, "");
const won = (n: unknown) => `${Math.round(Number(n) || 0).toLocaleString("ko-KR")}원`;
const isEmail = (v: unknown) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || "").trim());
const bizNo = (v: unknown) => {
  const d = String(v || "").replace(/\D/g, "");
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : String(v || "");
};

serve(withSentry("send-issue-request-email", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const caller = await resolveCaller(req);
    if (!caller) return deny("회사에 소속된 계정만 보낼 수 있습니다.", 403, corsHeaders);

    const { requestId } = await req.json().catch(() => ({}));
    if (!requestId || typeof requestId !== "string") return json({ error: "requestId 가 필요합니다." }, 400);

    // 호출자 권한으로 읽는다 — RLS 가 '우리 회사 + 세금계산서 권한'을 본다
    const asUser = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } });
    const { data: r } = await asUser.from("tax_invoice_requests").select("*").eq("id", requestId).maybeSingle();
    if (!r || r.company_id !== caller.companyId) return deny("요청을 찾을 수 없거나 권한이 없습니다.", 404, corsHeaders);
    if (r.status !== "sent" && r.status !== "viewed") return json({ error: "이미 발행됐거나 취소된 요청입니다." }, 409);
    if (r.expires_at && Date.parse(r.expires_at) < Date.now()) return json({ error: "기한이 지난 요청입니다. 새로 만들어 보내 주세요." }, 409);
    if (!isEmail(r.supplier_email)) return json({ error: "공급자 이메일이 올바르지 않습니다." }, 400);
    //   연타·반복 발송 막기 — 같은 요청은 1분에 한 번
    if (r.last_sent_at && Date.now() - Date.parse(r.last_sent_at) < 60_000) {
      return json({ error: "방금 보냈습니다. 1분 뒤에 다시 보내 주세요." }, 429);
    }

    const link = `${SITE}/issue-request?token=${encodeURIComponent(r.token)}`;
    if (!isAppUrl(link)) return json({ error: "링크 주소 설정이 올바르지 않습니다." }, 500);

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) return json({ error: "메일 발송 설정(RESEND_API_KEY)이 없습니다." }, 500);

    const buyer = r.buyer_name || "거래처";
    const items: { name?: string; supply_amount?: number; tax_amount?: number }[] = Array.isArray(r.items) ? r.items : [];
    const itemLabel = items.length === 0 ? (r.title || "-")
      : items.length === 1 ? String(items[0].name || r.title || "-")
      : `${items[0].name || ""} 외 ${items.length - 1}건`;
    const td = "padding:9px 12px;border:1px solid #e5e7eb;font-size:13px";
    const th = `${td};background:#f6f7f9;color:#555;font-weight:600;width:120px`;
    const expires = r.expires_at ? String(r.expires_at).slice(0, 10) : "";

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#1c2030;background:#f9fafb">
  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">
    <p style="font-size:12px;color:#6b7080;margin:0 0 6px">세금계산서 발행 요청</p>
    <h1 style="font-size:18px;margin:0 0 14px">${esc(buyer)}에서 세금계산서 발행을 요청했습니다</h1>
    <p style="font-size:13.5px;line-height:1.7;margin:0 0 18px">
      ${esc(r.supplier_name || "")} 담당자님, 아래 내용으로 세금계산서를 발행해 주세요.<br>
      버튼을 누르면 내용이 모두 채워진 화면이 열립니다. <b>작성일자만 넣고 발행</b>하면 됩니다.
    </p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 16px">
      <tr><td style="${th}">공급받는자</td><td style="${td}">${esc(buyer)}${r.buyer_business_number ? ` (${esc(bizNo(r.buyer_business_number))})` : ""}</td></tr>
      <tr><td style="${th}">대금지급액<br><span style="font-weight:400;font-size:11px">(세금 포함)</span></td><td style="${td};font-weight:800;font-size:15px">${won(r.total_amount)}</td></tr>
      <tr><td style="${th}">지급예정일</td><td style="${td}">${esc(r.pay_due_date || "-")}</td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;margin:0 0 16px">
      <tr>
        <td style="${td};background:#f6f7f9;font-weight:600;text-align:center">발주번호</td>
        <td style="${td};background:#f6f7f9;font-weight:600;text-align:center">발주명</td>
        <td style="${td};background:#f6f7f9;font-weight:600;text-align:center">금액</td>
      </tr>
      <tr>
        <td style="${td};text-align:center">${esc(r.po_number || "-")}</td>
        <td style="${td}">${esc(r.title || itemLabel)}</td>
        <td style="${td};text-align:right">${won(r.total_amount)}</td>
      </tr>
    </table>
    ${r.pay_bank_text ? `<p style="font-size:13px;margin:0 0 18px"><b>입금계좌</b> &nbsp; ${esc(r.pay_bank_text)}</p>` : ""}
    <a href="${esc(link)}" style="display:inline-block;padding:12px 22px;background:#4f46e5;color:#fff;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none">세금계산서 발행하기</a>
    <p style="font-size:12px;color:#6b7080;line-height:1.7;margin:18px 0 0">
      · 세금계산서는 공급자 명의로 발행됩니다. 홈택스에서 직접 발행하셔도 되고, 링크 화면에서 바로 발행할 수도 있습니다.<br>
      ${expires ? `· 이 링크는 ${esc(expires)}까지 열립니다.<br>` : ""}
      · 문의는 이 메일에 회신하시면 ${esc(buyer)} 담당자에게 전달됩니다.
    </p>
  </div>
  <p style="font-size:11px;color:#9aa0b0;text-align:center;margin:14px 0 0">오너뷰를 통해 ${esc(buyer)}에서 보낸 메일입니다.</p>
</body></html>`;

    const payload: Record<string, unknown> = {
      from: Deno.env.get("RESEND_FROM_EMAIL") || "오너뷰 <noreply@owner-view.com>",
      to: [String(r.supplier_email).trim()],
      subject: `[세금계산서 발행 요청] ${buyer} · ${won(r.total_amount)}`,
      html,
    };
    if (isEmail(r.buyer_email)) payload.reply_to = String(r.buyer_email).trim();

    const res = await tfetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error("[send-issue-request-email] resend failed:", res.status, t.slice(0, 300));
      return json({ error: "메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요." }, 502);
    }
    const sent = await res.json().catch(() => ({}));

    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    await admin.from("tax_invoice_requests").update({ last_sent_at: new Date().toISOString() }).eq("id", r.id);

    return json({ success: true, emailId: (sent as { id?: string }).id || null });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
}));
