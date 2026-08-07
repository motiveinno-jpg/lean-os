// supabase/functions/toss-webhook/index.ts
// 토스페이먼츠 웹훅 수신 (2026-08-07)
//
// 왜 필요한가: 지금은 우리가 결제를 건 순간에만 결과를 안다. 결제가 나중에 취소되거나
//   카드사에서 상태가 바뀌면 우리는 영영 모른다 — 돈은 안 들어왔는데 서비스는 열린 채로 남는다.
//
// ⚠️ 토스 웹훅에는 Stripe 같은 서명이 없다. 그래서 **본문을 믿지 않는다**:
//   paymentKey 만 꺼내 토스 조회 API 로 되물어보고, 그 응답만 근거로 처리한다.
//   위조 요청이 와도 (1) 우리 청구서에 없는 주문이면 무시, (2) 상태는 토스가 알려준 값만 쓴다.
//
// Deploy: supabase functions deploy toss-webhook --use-api --no-verify-jwt

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { tfetch } from "../_shared/http.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// 결제가 무효가 된 상태들 — 이용 권한을 걷어야 한다.
const VOID_STATUSES = new Set(["CANCELED", "PARTIAL_CANCELED", "EXPIRED", "ABORTED"]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function notifyMasters(
  supabase: any, companyId: string, title: string, message: string,
) {
  try {
    const { data: masters } = await supabase
      .from("users").select("id").eq("company_id", companyId).eq("is_master", true);
    const rows = (masters || []).map((m: { id: string }) => ({
      company_id: companyId, user_id: m.id, type: "billing", title, message, link: "/billing",
    }));
    if (rows.length) await supabase.from("notifications").insert(rows);
  } catch (e) {
    console.error("notifyMasters failed", e);
  }
}

serve(withSentry("toss-webhook", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  // 토스가 재전송하지 않도록 실패해도 200 을 준다 — 처리 결과는 로그·이벤트로 남긴다.
  if (req.method !== "POST") return json({ ok: true, ignored: "method" });

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ ok: true, ignored: "bad json" }); }

  // 이벤트 모양이 여러 가지라 paymentKey 를 넓게 찾는다(data.paymentKey / paymentKey).
  const paymentKey: string | undefined = body?.data?.paymentKey || body?.paymentKey;
  const orderIdHint: string | undefined = body?.data?.orderId || body?.orderId;
  if (!paymentKey) return json({ ok: true, ignored: "no paymentKey" });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const secretKey = Deno.env.get("TOSS_SECRET_KEY");
  if (!secretKey) {
    console.error("TOSS_SECRET_KEY not configured — webhook ignored");
    return json({ ok: true, ignored: "not configured" });
  }

  // ── 본문을 믿지 않고 토스에 되묻는다 ──
  let payment: Record<string, any>;
  try {
    const res = await tfetch(`https://api.tosspayments.com/v1/payments/${paymentKey}`, {
      headers: { Authorization: `Basic ${btoa(`${secretKey}:`)}` },
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("payment lookup failed", data?.code, data?.message);
      return json({ ok: true, ignored: "lookup failed" });
    }
    payment = data;
  } catch (e) {
    console.error("payment lookup exception", e);
    return json({ ok: true, ignored: "lookup error" });
  }

  const status = String(payment.status || "");
  const orderId = String(payment.orderId || orderIdHint || "");

  // 우리 청구서에 없는 주문이면 우리 일이 아니다(위조·타 상점 요청 차단).
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, company_id, subscription_id, total_amount, status")
    .eq("toss_order_id", orderId)
    .maybeSingle();
  if (!invoice) return json({ ok: true, ignored: "unknown order" });

  if (!VOID_STATUSES.has(status)) {
    // DONE 등 정상 상태 — 이미 반영돼 있다. 흔적만 남기고 끝낸다.
    return json({ ok: true, status, handled: false });
  }

  // ── 결제가 무효가 됐다 — 청구서를 되돌리고 구독을 미납으로 내린다 ──
  if (invoice.status !== "canceled") {
    await supabase.from("invoices")
      .update({ status: "canceled" })
      .eq("id", invoice.id);

    if (invoice.subscription_id) {
      await supabase.from("subscriptions").update({
        status: "past_due",
        last_payment_error: `토스 결제 ${status}`,
        updated_at: new Date().toISOString(),
      }).eq("id", invoice.subscription_id);
    }

    await supabase.from("billing_events").insert({
      company_id: invoice.company_id,
      event_type: "refund",
      metadata: { provider: "toss", orderId, paymentKey, status, amount: invoice.total_amount },
    });

    await notifyMasters(
      supabase, invoice.company_id,
      "결제가 취소되었습니다",
      `${Number(invoice.total_amount).toLocaleString("ko-KR")}원 결제가 취소(${status})되어 구독이 미납 상태가 되었습니다. 결제수단을 확인해 주세요.`,
    );
  }

  return json({ ok: true, status, handled: true });
}));
