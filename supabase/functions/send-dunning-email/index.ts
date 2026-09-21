// 미수금·미지급금 안내 메일 (2026-09-21, 랜딩 문구 대조 → "납부 마감이 지난 회원에게 안내를 보냅니다" 를 참으로)
//   거래처 원장 › 연령표의 '안내 메일' 버튼이 부른다. 그전엔 문구를 복사해 사람이 카톡·메일로 보냈다(발송 기록도 손으로).
//
//   ★ 자체 포함 — MCP 배포는 ../_shared 를 번들하지 못한다(2026-09-16 send-inquiry-notification 과 같은 이유).
//     mail-guard 의 규칙을 그대로 옮겼다: ① 호출자는 회사 소속 계정 ② 받는 주소는 **그 회사 거래처의 이메일**일 때만
//     ③ 본문 문자열은 전부 escape ④ 링크 없음(피싱 통로 차단). 금액·건수는 서버가 다시 계산하지 않고 화면 값을 받되 숫자로만 쓴다.
//   ★ 발송은 사람이 버튼을 눌러야 나간다 — 자동 발송 없음(제안은 자동, 확정은 사람).
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const won = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const anon = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await anon.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { data: me } = await admin.from("users").select("id, company_id, name").eq("auth_id", user.id).maybeSingle();
    if (!me?.company_id) return json({ error: "회사에 소속된 계정만 보낼 수 있습니다." }, 403);

    const body = await req.json().catch(() => ({}));
    const partnerId = String(body.partnerId || "");
    const side: "AR" | "AP" = body.side === "AP" ? "AP" : "AR";
    const total = Number(body.total || 0), count = Number(body.count || 0);
    const oldestDate = typeof body.oldestDate === "string" ? body.oldestDate.slice(0, 10) : "";
    const extra = typeof body.message === "string" ? body.message.slice(0, 500) : "";
    if (!partnerId || !(total > 0)) return json({ error: "partnerId·total 이 필요합니다." }, 400);

    //   받는 사람 = 그 회사의 거래처 이메일. 요청이 준 주소는 쓰지 않는다.
    const { data: partner } = await admin.from("partners").select("id, name, contact_email, contact_name").eq("id", partnerId).eq("company_id", me.company_id).maybeSingle();
    if (!partner) return json({ error: "우리 회사 거래처가 아닙니다." }, 403);
    const to = String(partner.contact_email || "").trim().toLowerCase();
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json({ error: "거래처에 이메일이 없습니다. 거래처 정보에 담당자 이메일을 넣어 주세요." }, 400);
    const { data: company } = await admin.from("companies").select("name").eq("id", me.company_id).maybeSingle();
    const companyName = String(company?.name || "오너뷰");

    const what = side === "AR" ? "미수금" : "미지급금";
    const ask = side === "AR" ? "입금" : "지급";
    const subject = `[${companyName}] ${what} ${won(total)} ${ask} 일정 확인 요청`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
      <div style="background:#1a1a2e;color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="margin:0;font-size:20px">${esc(companyName)}</h1>
        <p style="margin:8px 0 0;opacity:0.8;font-size:14px">${esc(what)} 안내</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px">
        <p style="font-size:15px;margin:0 0 12px">${esc(partner.name)} ${esc(partner.contact_name ? partner.contact_name + " " : "")}담당자님, 안녕하세요.</p>
        <p style="font-size:14px;margin:0 0 12px">${esc(companyName)}의 ${esc(what)} ${esc(won(total))}(${count}건${oldestDate ? `, 가장 오래된 계산서 ${esc(oldestDate)}` : ""})의 ${esc(ask)} 일정을 확인 부탁드립니다.</p>
        <div style="background:#f3f4f6;border-radius:8px;padding:16px;margin:16px 0">
          <p style="margin:0;font-size:14px"><strong>${esc(what)} 합계</strong> ${esc(won(total))}</p>
          <p style="margin:6px 0 0;font-size:13px;color:#6b7280">${count}건${oldestDate ? ` · 가장 오래된 계산서 ${esc(oldestDate)}` : ""}</p>
        </div>
        ${extra ? `<p style="font-size:13px;margin:0 0 12px;white-space:pre-wrap">${esc(extra)}</p>` : ""}
        <p style="font-size:13px;margin:0">이미 처리하셨다면 이 메일은 무시하셔도 됩니다. 감사합니다.</p>
        <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;text-align:center">${esc(companyName)} · ${esc(me.name || "담당자")} 님이 오너뷰에서 보냈습니다.</p>
      </div>
    </body></html>`;

    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) return json({ error: "메일 발송 설정이 없습니다(RESEND_API_KEY)." }, 500);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ from: Deno.env.get("RESEND_FROM_EMAIL") || "오너뷰 <noreply@owner-view.com>", to: [to], subject, html }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return json({ success: false, error: (await res.text()).slice(0, 300) }, 500);
    return json({ success: true, to });
  } catch (e) {
    return json({ error: (e as Error).message || "발송 실패" }, 500);
  }
});
