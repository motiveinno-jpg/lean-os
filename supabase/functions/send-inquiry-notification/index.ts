import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

/**
 * OwnerView — 도입·제휴 문의 접수 내부 알림 메일 (2026-09-16 신설).
 *
 *   배경: /contact 로 상담 신청이 들어와도 DB 에 쌓이기만 했다. 운영자 화면(/platform/partnership)을
 *     직접 열어 봐야 알 수 있어, 소개 메일을 뿌리면 들어온 문의를 그냥 흘리게 된다.
 *
 *   호출: Next 서버 /api/partnership 이 insert 성공 후 호출(진실원천은 DB, 이 메일은 알림일 뿐).
 *   가드: Supabase 게이트웨이가 JWT 를 검증한 뒤, 여기서 role 이 service_role 인지 한 번 더 본다.
 *     ⚠️ 공유 비밀값(x-internal-secret)을 새로 만들지 않았다 — 양쪽 env 에 새 값을 넣어야 하고,
 *        빠지면 알림이 조용히 꺼진다. 서버만 가진 service_role 키로 인증하면 설정할 것이 없다.
 *   ⚠️ 수신자는 env 고정 — 호출측이 바꿀 수 없다(임의 주소로 메일 보내는 통로가 되면 안 된다).
 *   ⚠️ Resend 실패해도 문의 접수는 성공으로 둔다. 문의를 잃는 것보다 알림을 놓치는 편이 낫다.
 *   ▸ MCP 로 배포하므로 ../_shared 를 쓰지 않고 자체 포함한다(번들되지 않음).
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const kst = (iso?: string | null) => {
  try {
    return new Date(iso || Date.now()).toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return "-"; }
};

// 게이트웨이가 서명을 이미 검증했으므로 payload 만 읽는다.
function jwtRole(auth: string | null): string {
  try {
    const tok = (auth || "").replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return String(payload?.role || "");
  } catch { return ""; }
}

serve(async (req) => {
  const j = (b: Record<string, unknown>, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return j({ error: "Method not allowed" }, 405);

  if (jwtRole(req.headers.get("authorization")) !== "service_role") return j({ error: "forbidden" }, 403);

  try {
    const p = await req.json().catch(() => ({}));

    const companyName = String(p.company_name ?? "").slice(0, 120) || "-";
    const contactName = String(p.contact_name ?? "").slice(0, 60) || "-";
    const email = String(p.email ?? "").slice(0, 160);
    const phone = String(p.phone ?? "").slice(0, 40);
    const message = String(p.message ?? "").slice(0, 4000);
    const when = kst(p.created_at);

    const recipient = Deno.env.get("INQUIRY_NOTIFICATION_EMAIL")
      || Deno.env.get("BILLING_NOTIFICATION_EMAIL")
      || "creative@mo-tive.com";

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) return j({ ok: false, skipped: "RESEND_API_KEY missing" });

    const rows: [string, string][] = [
      ["회사", companyName],
      ["담당자", contactName],
      ["이메일", email || "-"],
      ["연락처", phone || "-"],
      ["접수", when],
    ];

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#f4f5f8;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#191f28">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
    <div style="background:#262a6b;color:#fff;padding:18px 24px">
      <div style="font-size:12px;opacity:.75;letter-spacing:.3px">오너뷰 · 도입 상담 신청</div>
      <div style="font-size:19px;font-weight:bold;margin-top:4px">${esc(companyName)} 에서 문의가 들어왔습니다</div>
    </div>
    <div style="padding:22px 24px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;line-height:1.8">
        ${rows.map(([k, v]) => `<tr>
          <td style="width:74px;color:#8b95a1;vertical-align:top;padding:3px 0">${esc(k)}</td>
          <td style="color:#191f28;padding:3px 0">${esc(v)}</td>
        </tr>`).join("")}
      </table>
      ${message ? `<div style="margin-top:16px;background:#f6f7fb;border-radius:8px;padding:14px 16px;font-size:14px;line-height:1.75;white-space:pre-wrap">${esc(message)}</div>` : ""}
      <div style="margin-top:22px">
        ${email ? `<a href="mailto:${esc(email)}" style="display:inline-block;background:#4a47c9;color:#fff;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 22px;border-radius:8px">바로 답장하기</a>` : ""}
        <a href="https://www.owner-view.com/platform/partnership" style="display:inline-block;margin-left:6px;color:#4e5968;text-decoration:none;font-size:14px;padding:12px 18px;border:1px solid #d7dbe6;border-radius:8px">문의함 열기</a>
      </div>
      <p style="margin:18px 0 0;font-size:12px;color:#8b95a1">
        이 메일에 회신하면 신청하신 분께 바로 갑니다. 연락한 뒤에는 문의함에서 '연락함'으로 바꿔 주세요.
      </p>
    </div>
  </div>
</body></html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: Deno.env.get("RESEND_FROM_EMAIL") || "오너뷰 <noreply@owner-view.com>",
        to: [recipient],
        //   답장이 신청자에게 바로 가게 한다 — 문의함을 열지 않고도 처리할 수 있어야 빨라진다.
        ...(email ? { reply_to: email } : {}),
        subject: `[도입문의] ${companyName} · ${contactName}`,
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[inquiry-notify] resend 실패:", res.status, body.slice(0, 300));
      return j({ ok: false, status: res.status }, 200); // 접수는 이미 끝났다 — 호출측을 실패시키지 않는다
    }

    const out = await res.json().catch(() => ({}));
    return j({ ok: true, id: out?.id ?? null });
  } catch (e) {
    console.error("[inquiry-notify] 오류:", e instanceof Error ? e.message : String(e));
    return j({ ok: false }, 200);
  }
});
