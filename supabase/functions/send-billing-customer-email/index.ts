// 구독 결제 결과를 고객에게 알리는 메일 (2026-09-28) — 토스(toss-charge)·Stripe(/api/stripe/webhook) 공용.
//
//   · paid   — 결제 완료: 금액(공급가·부가세)·이용 기간·다음 결제일·카드 매출전표 링크(부가세 매입 증빙)
//   · failed — 결제 실패: 사유·다음 재시도 또는 재시도 소진 안내·결제수단 변경 링크
//
//   가드: x-internal-secret === BILLING_HOOK_SECRET (결제 코드만 부른다).
//   받는 사람은 호출자가 정하지 않는다 — 그 회사의 마스터 계정 이메일을 여기서 찾는다.
//   같은 dedupe_key 는 한 번만 보낸다(billing_customer_emails 유니크). 실패해도 결제 처리는 막지 않는다(호출부가 무시).
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-internal-secret, apikey" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const won = (n: unknown) => `${Math.round(Number(n) || 0).toLocaleString("ko-KR")}원`;
const day = (iso?: string | null) => {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" }); } catch { return ""; }
};
const SITE = "https://www.owner-view.com";
const FROM = "오너뷰 <noreply@owner-view.com>";
const REPLY_TO = "creative@mo-tive.com";
const isHttps = (u: unknown) => typeof u === "string" && /^https:\/\/[^\s"<>]+$/.test(u);

function layout(heading: string, bodyHtml: string, rows: [string, string][], button?: { href: string; label: string }, foot = "") {
  const table = rows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0;border-top:1px solid #eef0f6;">${rows.map(([k, v]) =>
    `<tr><td style="padding:10px 0;border-bottom:1px solid #eef0f6;font-size:14px;color:#71717a;width:120px;">${esc(k)}</td><td style="padding:10px 0;border-bottom:1px solid #eef0f6;font-size:14px;color:#18181b;text-align:right;font-weight:600;">${v}</td></tr>`).join("")}</table>` : "";
  const btn = button ? `<tr><td align="center" style="padding:26px 32px 4px;"><a href="${esc(button.href)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:13px 32px;border-radius:10px;">${esc(button.label)}</a></td></tr>` : "";
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5fb;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5fb;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e5e7f0;border-radius:16px;font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#18181b;">
<tr><td style="padding:32px 32px 8px;"><img src="${SITE}/icon-192.png" width="40" height="40" alt="오너뷰" style="display:block;border-radius:10px;">
<p style="margin:20px 0 0;font-size:13px;font-weight:700;color:#4f46e5;">오너뷰</p><h1 style="margin:6px 0 0;font-size:22px;line-height:1.4;font-weight:800;">${esc(heading)}</h1></td></tr>
<tr><td style="padding:12px 32px 0;font-size:15px;line-height:1.7;color:#3f3f46;">${bodyHtml}${table}</td></tr>
${btn}
<tr><td style="padding:24px 32px 28px;font-size:12px;line-height:1.7;color:#a1a1aa;">${foot}${foot ? "<br>" : ""}문의: ${REPLY_TO} (이 메일에 회신하셔도 됩니다)<br>주식회사 모티브이노베이션 · 오너뷰 · <a href="${SITE}" style="color:#a1a1aa;">www.owner-view.com</a></td></tr>
</table></td></tr></table></body></html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const secret = Deno.env.get("BILLING_HOOK_SECRET");
  if (!secret || req.headers.get("x-internal-secret") !== secret) return json({ error: "forbidden" }, 403);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const p = await req.json().catch(() => ({} as Record<string, unknown>));
  const kind = p.kind === "failed" ? "failed" : p.kind === "paid" ? "paid" : null;
  const companyId = typeof p.company_id === "string" ? p.company_id : "";
  const dedupeKey = typeof p.dedupe_key === "string" ? p.dedupe_key.slice(0, 200) : "";
  if (!kind || !companyId || !dedupeKey) return json({ error: "kind, company_id, dedupe_key required" }, 400);

  // 받는 사람 = 그 회사 마스터(대표·관리자) 계정
  const { data: masters } = await admin.from("users").select("email").eq("company_id", companyId).eq("is_master", true);
  const recipients = [...new Set(((masters || []) as { email: string | null }[]).map((m) => (m.email || "").trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !e.endsWith("@deleted.local")))].slice(0, 5);

  const { error: insErr } = await admin.from("billing_customer_emails").insert({
    dedupe_key: dedupeKey, company_id: companyId, kind, recipients, status: recipients.length ? "pending" : "skipped",
  });
  if (insErr) {
    if (insErr.code === "23505") {
      const { data: ex } = await admin.from("billing_customer_emails").select("status").eq("dedupe_key", dedupeKey).maybeSingle();
      if (ex?.status === "sent" || ex?.status === "skipped") return json({ ok: true, skipped: "already" });
    } else return json({ error: "db_error" }, 500);
  }
  if (!recipients.length) return json({ ok: true, skipped: "no_recipient" });

  const { data: company } = await admin.from("companies").select("name").eq("id", companyId).maybeSingle();
  const coName = company?.name || "귀사";
  const amount = Number(p.amount_krw) || 0;
  const supply = Number(p.supply_krw) || Math.round(amount / 1.1);
  const vat = Number(p.vat_krw) || amount - supply;
  const provider = p.provider === "stripe" ? "해외카드" : "국내카드";

  let subject: string, html: string;
  if (kind === "paid") {
    const receipt = isHttps(p.receipt_url) ? String(p.receipt_url) : "";
    const rows: [string, string][] = [
      ["결제 금액", `${won(amount)} <span style="font-weight:400;color:#71717a;">(공급가 ${won(supply)} + 부가세 ${won(vat)})</span>`],
      ["내용", esc(p.description || "오너뷰 구독 이용료")],
    ];
    if (p.period_start || p.period_end) rows.push(["이용 기간", `${esc(day(p.period_start as string))} ~ ${esc(day(p.period_end as string))}`]);
    if (p.next_billing_at) rows.push(["다음 결제일", esc(day(p.next_billing_at as string))]);
    rows.push(["결제 수단", esc(provider)]);
    subject = `[오너뷰] 구독 결제가 완료되었습니다 (${won(amount)})`;
    html = layout("구독 결제가 완료되었습니다",
      `<b>${esc(coName)}</b>의 오너뷰 이용료가 결제되었습니다. 이용해 주셔서 감사합니다.`,
      rows,
      receipt ? { href: receipt, label: p.provider === "stripe" ? "영수증 보기" : "카드 매출전표 보기" } : { href: `${SITE}/billing`, label: "청구서 보기" },
      receipt && p.provider !== "stripe" ? "카드 매출전표는 부가세 매입세액 공제 증빙으로 쓸 수 있습니다. 결제 내역은 오너뷰 › 설정 › 요금제 › 결제 탭에서도 볼 수 있습니다." : "결제 내역은 오너뷰 › 설정 › 요금제 › 결제 탭에서 볼 수 있습니다.");
  } else {
    const exhausted = p.exhausted === true;
    const rows: [string, string][] = [
      ["결제 금액", won(amount)],
      ["실패 사유", esc(p.fail_reason || "카드사 승인 거절")],
    ];
    if (!exhausted && p.next_retry_at) rows.push(["다음 재시도", esc(day(p.next_retry_at as string))]);
    if (p.access_until) rows.push([exhausted ? "이용 종료" : "이용 가능", `${esc(day(p.access_until as string))}까지`]);
    subject = exhausted ? "[오너뷰] 구독 결제가 최종 실패했습니다 — 결제수단을 확인해 주세요" : "[오너뷰] 구독 결제가 실패했습니다";
    html = layout(exhausted ? "구독 결제가 최종 실패했습니다" : "구독 결제가 실패했습니다",
      exhausted
        ? `<b>${esc(coName)}</b>의 오너뷰 이용료 결제가 세 번 모두 실패했습니다. 표시된 날짜 이후에는 무료 요금제로 바뀝니다. 카드를 확인하거나 다른 카드로 바꾼 뒤 설정 › 요금제 화면에서 다시 결제해 주세요.`
        : `<b>${esc(coName)}</b>의 오너뷰 이용료 결제가 실패했습니다. 카드 한도·유효기간을 확인해 주세요. 카드를 바꾸면 다음 재시도부터 새 카드로 결제합니다.`,
      rows, { href: `${SITE}/billing`, label: "결제수단 확인하기" });
  }

  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return json({ error: "RESEND_API_KEY missing" }, 500);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `billing-customer-${dedupeKey}`.slice(0, 256) },
    body: JSON.stringify({ from: FROM, to: recipients, reply_to: REPLY_TO, subject, html, tags: [{ name: "type", value: `billing_${kind}` }] }),
  });
  const r = await res.json().catch(() => ({}));
  await admin.from("billing_customer_emails").update(res.ok
    ? { status: "sent", resend_email_id: r?.id || null, sent_at: new Date().toISOString(), last_error: null }
    : { status: "failed", last_error: String(r?.message || res.status).slice(0, 300) }).eq("dedupe_key", dedupeKey);
  return json(res.ok ? { ok: true, id: r?.id } : { ok: false, error: r?.message || res.status }, res.ok ? 200 : 502);
});
