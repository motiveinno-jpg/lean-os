// supabase/functions/toss-charge/index.ts
// 토스페이먼츠 자동결제 2단계 — 빌링키로 실제 청구 + 매월 갱신 (2026-08-07)
//
// mode:
//   "due" (cron) — 청구일이 된 토스 구독을 전부 순회 결제. 서비스 롤 토큰으로만 호출 가능.
//   "one"        — 한 회사만 즉시 청구(마스터 본인 회사, 또는 서비스 롤 + companyId).
//
// 토스는 Stripe 처럼 구독을 대신 굴려주지 않는다. 그래서 여기서 직접:
//   금액 계산 → 결제 API 호출 → 성공 시 다음 주기로 밀기 / 실패 시 재시도·미납 판정.
//
// ⚠️ 이중 청구 방지가 이 함수의 생명이다:
//   orderId 를 (회사, 주기)로 결정적으로 만들고 Idempotency-Key 로 보낸다.
//   cron 이 두 번 돌거나 재시도가 겹쳐도 토스가 같은 주문을 두 번 승인하지 않는다.
//
// Deploy: supabase functions deploy toss-charge --use-api

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { tfetch } from "../_shared/http.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_RETRIES = 3;      // 3회 실패하면 미납(past_due)
const RETRY_AFTER_DAYS = 3; // 화면 안내와 동일: "결제 실패 시 3일 후 재시도"
const VAT_RATE = 0.1;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// 빌링키 복호화 — 등록(toss-billing-key)에서 AES-GCM 으로 넣은 값을 되돌린다.
async function decryptSecret(encB64: string): Promise<string> {
  const raw = Deno.env.get("TOSS_BILLING_ENC_KEY");
  if (!raw) throw new Error("TOSS_BILLING_ENC_KEY not configured");
  const keyBytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const all = Uint8Array.from(atob(encB64), (c) => c.charCodeAt(0));
  const iv = all.slice(0, 12);
  const data = all.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(plain);
}

// 주기 라벨 — orderId 를 결정적으로 만드는 재료(같은 주기는 같은 주문).
function periodTag(periodStart: Date): string {
  const y = periodStart.getUTCFullYear();
  const m = String(periodStart.getUTCMonth() + 1).padStart(2, "0");
  const d = String(periodStart.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function addPeriod(from: Date, cycle: string): Date {
  const d = new Date(from.getTime());
  if (cycle === "yearly" || cycle === "annual") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

type ChargeOutcome = { companyId: string; ok: boolean; amount?: number; error?: string; code?: string };

serve(withSentry("toss-charge", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing authorization" }, 401);
  const token = authHeader.slice("Bearer ".length);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  let body: { mode?: string; companyId?: string };
  try { body = await req.json(); } catch { body = {}; }
  const mode = body.mode || "due";

  // 호출자 판정 — cron 은 서비스 롤 토큰, 사람은 로그인 JWT.
  const isService = token === serviceKey;
  let callerCompanyId: string | null = null;
  if (!isService) {
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
    // 신원 대조는 users.auth_id 로만 한다.
    const { data: profile } = await supabase
      .from("users").select("company_id, is_master").eq("auth_id", userData.user.id).maybeSingle();
    if (!profile?.company_id) return json({ error: "Company not found" }, 403);
    if (!profile.is_master) return json({ error: "결제 실행은 마스터만 할 수 있습니다." }, 403);
    callerCompanyId = profile.company_id as string;
    if (mode === "due") return json({ error: "일괄 청구는 시스템만 실행합니다." }, 403);
  }

  const secretKey = Deno.env.get("TOSS_SECRET_KEY");
  if (!secretKey) return json({ error: "Payment gateway not configured (TOSS_SECRET_KEY)" }, 500);

  // ── 대상 구독 조회 ──
  const nowIso = new Date().toISOString();
  let q = supabase
    .from("subscriptions")
    .select("id, company_id, plan_id, plan_slug, seat_count, billing_cycle, status, current_period_start, current_period_end, payment_retry_count, next_retry_at")
    .eq("payment_provider", "toss")
    .in("status", ["active", "trialing", "past_due"]);

  if (mode === "one") {
    const target = isService ? body.companyId : callerCompanyId;
    if (!target) return json({ error: "companyId required" }, 400);
    q = q.eq("company_id", target);
  } else {
    // 청구일이 지났고, 재시도 대기 중이 아닌 건만
    q = q.lte("current_period_end", nowIso);
  }

  const { data: subs, error: subErr } = await q;
  if (subErr) return json({ error: subErr.message }, 500);

  const targets = (subs || []).filter((s: any) =>
    mode === "one" || !s.next_retry_at || s.next_retry_at <= nowIso
  );
  if (targets.length === 0) return json({ ok: true, charged: 0, results: [] });

  // 요금제는 한 번만 읽어 재사용
  const { data: plans } = await supabase
    .from("subscription_plans").select("id, slug, base_price, per_seat_price, included_seats, annual_discount");
  const planById = new Map((plans || []).map((p: any) => [p.id, p]));

  const results: ChargeOutcome[] = [];

  for (const s of targets as any[]) {
    const plan = planById.get(s.plan_id);
    if (!plan) { results.push({ companyId: s.company_id, ok: false, error: "요금제를 찾을 수 없습니다" }); continue; }

    // 무료 플랜은 청구 대상이 아니다 — 주기만 다음으로 밀어 둔다.
    const supplyMonthly = Math.round(
      Number(plan.base_price) +
      Math.max(0, (s.seat_count || 1) - (plan.included_seats ?? 0)) * Number(plan.per_seat_price),
    );
    const yearly = s.billing_cycle === "yearly" || s.billing_cycle === "annual";
    const supply = yearly
      ? Math.round(supplyMonthly * 12 * (1 - Number(plan.annual_discount || 0)))
      : supplyMonthly;
    const periodStart = new Date(s.current_period_end || nowIso);
    const periodEnd = addPeriod(periodStart, s.billing_cycle || "monthly");

    if (supply <= 0) {
      await supabase.from("subscriptions").update({
        current_period_start: periodStart.toISOString(),
        current_period_end: periodEnd.toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", s.id);
      results.push({ companyId: s.company_id, ok: true, amount: 0 });
      continue;
    }

    const tax = Math.round(supply * VAT_RATE);
    const total = supply + tax;

    // 빌링키
    const { data: keyRow } = await supabase
      .from("toss_billing_keys").select("customer_key, billing_key_enc").eq("company_id", s.company_id).maybeSingle();
    if (!keyRow?.billing_key_enc) {
      results.push({ companyId: s.company_id, ok: false, error: "등록된 카드가 없습니다" });
      await supabase.from("billing_events").insert({
        company_id: s.company_id, event_type: "payment_failed",
        metadata: { reason: "no_billing_key", amount: total },
      });
      continue;
    }

    let billingKey: string;
    try { billingKey = await decryptSecret(keyRow.billing_key_enc); }
    catch (e) {
      console.error("decrypt failed", e);
      results.push({ companyId: s.company_id, ok: false, error: "빌링키 복호화 실패" });
      continue;
    }

    // ⚠️ 같은 (회사, 주기) 는 항상 같은 orderId → 재시도·중복 실행에도 한 번만 승인된다.
    const orderId = `ov-${String(s.company_id).replace(/-/g, "").slice(0, 12)}-${periodTag(periodStart)}`;
    const orderName = `오너뷰 ${plan.slug === "standard" ? "구독" : plan.slug} ${yearly ? "연간" : "월"} 이용료`;

    let payment: Record<string, any> | null = null;
    let failMsg = "", failCode = "";
    try {
      const res = await tfetch(`https://api.tosspayments.com/v1/billing/${billingKey}`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${secretKey}:`)}`,
          "Content-Type": "application/json",
          "Idempotency-Key": orderId,
        },
        body: JSON.stringify({
          customerKey: keyRow.customer_key,
          amount: total,
          orderId,
          orderName,
          taxFreeAmount: 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) { failMsg = data?.message || "결제 실패"; failCode = data?.code || ""; }
      else payment = data;
    } catch (e) {
      failMsg = "결제 게이트웨이에 연결하지 못했습니다";
      console.error("toss charge call failed", e);
    }

    if (payment) {
      // 토스는 멱등키로 재요청이 오면 "원래 결제 응답"을 그대로 돌려준다(=돈은 한 번만 빠진다).
      //   그래서 여기서 그냥 insert 하면 같은 결제에 청구서만 두 줄이 생긴다 — 매출이 2배로 보인다.
      //   같은 주문번호의 청구서가 이미 있으면 만들지 않는다(2026-08-07 실결제 검증에서 잡음).
      const { data: dupInvoice } = await supabase
        .from("invoices").select("id").eq("toss_order_id", orderId).maybeSingle();
      if (!dupInvoice) await supabase.from("invoices").insert({
        company_id: s.company_id,
        subscription_id: s.id,
        amount: supply,
        tax_amount: tax,
        total_amount: total,
        status: "paid",
        toss_payment_key: payment.paymentKey,
        toss_order_id: orderId,
        paid_at: payment.approvedAt || new Date().toISOString(),
        description: orderName,
        billing_period_start: periodStart.toISOString(),
        billing_period_end: periodEnd.toISOString(),
        currency: "krw",
      });
      await supabase.from("subscriptions").update({
        status: "active",
        current_period_start: periodStart.toISOString(),
        current_period_end: periodEnd.toISOString(),
        payment_retry_count: 0,
        next_retry_at: null,
        last_payment_error: null,
        updated_at: new Date().toISOString(),
      }).eq("id", s.id);
      await supabase.from("billing_events").insert({
        company_id: s.company_id, event_type: "payment_success",
        metadata: { orderId, amount: total, paymentKey: payment.paymentKey, provider: "toss" },
      });
      results.push({ companyId: s.company_id, ok: true, amount: total });
      continue;
    }

    // 실패 — 주기는 밀지 않는다(다음 재시도에서 같은 orderId 로 다시 시도).
    const nextCount = (s.payment_retry_count || 0) + 1;
    const exhausted = nextCount >= MAX_RETRIES;
    const nextRetry = new Date(Date.now() + RETRY_AFTER_DAYS * 24 * 60 * 60 * 1000);
    await supabase.from("subscriptions").update({
      status: exhausted ? "past_due" : s.status,
      payment_retry_count: nextCount,
      next_retry_at: exhausted ? null : nextRetry.toISOString(),
      last_payment_error: `${failCode} ${failMsg}`.trim(),
      updated_at: new Date().toISOString(),
    }).eq("id", s.id);
    await supabase.from("billing_events").insert({
      company_id: s.company_id, event_type: "payment_failed",
      metadata: { orderId, amount: total, code: failCode, message: failMsg, attempt: nextCount, exhausted, provider: "toss" },
    });
    results.push({ companyId: s.company_id, ok: false, error: failMsg, code: failCode });
  }

  return json({ ok: true, charged: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
}));
