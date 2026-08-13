// supabase/functions/toss-charge/index.ts
// 토스페이먼츠 자동결제 2단계 — 빌링키로 실제 청구 + 매월 갱신 (2026-08-07)
//
// mode:
//   "due" (cron) — 청구일이 된 토스 구독을 전부 순회 결제. 서비스 롤 토큰으로만 호출 가능.
//   "one"        — 한 회사만 즉시 청구(마스터 본인 회사, 또는 서비스 롤 + companyId).
//   "start"      — 국내카드로 유료 구독 시작(마스터 전용, 2026-08-14). 구독 행을 토스 기준으로
//                  맞춘 뒤 공용 청구 루프로 즉시 1회 결제. 실패하면 구독 행을 원상복구한다.
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

// 결제 실패를 회사 마스터에게 알린다(인앱) — billing_events 에만 남으면 아무도 못 본다.
async function notifyPaymentFailed(
  supabase: any, companyId: string, amount: number, message: string, exhausted: boolean,
) {
  try {
    const { data: masters } = await supabase
      .from("users").select("id").eq("company_id", companyId).eq("is_master", true);
    const rows = (masters || []).map((m: { id: string }) => ({
      company_id: companyId,
      user_id: m.id,
      type: "billing",
      title: exhausted ? "결제 실패 — 서비스가 곧 제한됩니다" : "구독 결제가 실패했습니다",
      message: exhausted
        ? `${amount.toLocaleString("ko-KR")}원 결제가 3회 모두 실패했습니다. 결제수단을 다시 등록해 주세요. (${message})`
        : `${amount.toLocaleString("ko-KR")}원 결제가 실패했습니다. 3일 뒤 다시 시도합니다. (${message})`,
      link: "/billing",
    }));
    if (rows.length) await supabase.from("notifications").insert(rows);
  } catch (e) {
    console.error("notifyPaymentFailed failed", e); // 알림 실패가 결제 처리를 막지 않게
  }
}

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
  let callerAuthId: string | null = null;
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
    callerAuthId = userData.user.id;
    if (mode === "due") return json({ error: "일괄 청구는 시스템만 실행합니다." }, 403);
  }

  const secretKey = Deno.env.get("TOSS_SECRET_KEY");
  if (!secretKey) return json({ error: "Payment gateway not configured (TOSS_SECRET_KEY)" }, 500);

  const nowIso = new Date().toISOString();

  // ── mode "start": 국내카드로 유료 구독 시작 (2026-08-14) ──
  //   결제하기에서 국내카드를 고른 회사. 기존 구독 상태별로:
  //     Stripe 가 계속 갱신 중 → 409 (이중 청구 금지 — 전환 API 가 Stripe 를 먼저 끈다)
  //     해지 예약으로 남은 유료 기간 있음 → 기간 유지, 만기부터 토스 청구(즉시 청구 없음)
  //     그 외(무료·체험·만료) → 즉시 1회 결제, 실패 시 구독 행 원상복구
  let startSubId: string | null = null;
  let startRollback: (() => Promise<void>) | null = null;
  if (mode === "start") {
    if (isService) return json({ error: "start 는 마스터 로그인으로만 실행합니다." }, 403);
    const planSlug = String((body as Record<string, unknown>).planSlug || "");
    const cycleRaw = String((body as Record<string, unknown>).billingCycle || "monthly");
    // DB CHECK 는 monthly|annual 두 값만 허용한다.
    const billingCycle = cycleRaw === "annual" || cycleRaw === "yearly" ? "annual" : "monthly";

    const { data: startPlan } = await supabase
      .from("subscription_plans")
      .select("id, slug, base_price")
      .eq("slug", planSlug).eq("is_active", true).maybeSingle();
    if (!startPlan || Number(startPlan.base_price) <= 0) {
      return json({ error: "결제할 수 있는 요금제가 아닙니다." }, 400);
    }

    // 연간(1년치 일시불·환불 불가)은 동의 기록이 서버에 있어야 한다 — 화면 체크만으론
    // 요청을 직접 만들면 뚫린다 (2026-08-14 보안 리뷰 M-2).
    if (billingCycle === "annual") {
      const { data: consent } = await supabase
        .from("user_consents")
        .select("id")
        .eq("auth_id", callerAuthId)
        .eq("consent_type", "annual_billing_no_refund")
        .gte("agreed_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
        .limit(1).maybeSingle();
      if (!consent) return json({ error: "연간 결제는 환불 불가 안내에 동의해야 진행할 수 있습니다." }, 400);
    }

    const { data: cardRow } = await supabase
      .from("toss_billing_keys").select("billing_key_enc").eq("company_id", callerCompanyId).maybeSingle();
    if (!cardRow?.billing_key_enc) return json({ error: "국내카드를 먼저 등록해 주세요.", code: "NO_CARD" }, 400);

    const { data: prev } = await supabase
      .from("subscriptions").select("*").eq("company_id", callerCompanyId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();

    const nowMs = Date.now();
    const prevRemaining = !!(prev && prev.status === "active"
      && prev.current_period_end && new Date(prev.current_period_end).getTime() > nowMs);
    if (prevRemaining && prev.payment_provider === "toss") {
      return json({ error: "이미 국내카드로 구독 중입니다.", code: "ALREADY_ACTIVE" }, 409);
    }
    // Stripe 구독 id 가 걸려 있으면 해지 예약 여부와 무관하게 여기서 처리하지 않는다 —
    // 우리 DB 의 cancel_at_period_end 만 믿고 id 를 지우면, 웹훅 유실로 Stripe 가 살아있는
    // 회사에서 이중 청구 + 웹훅 영구 무음이 된다 (2026-08-14 보안 리뷰 C-1).
    // Stripe 실취소를 수행하는 /api/billing/switch-to-toss 만 이 링크를 끊을 수 있다.
    if (prevRemaining && prev.stripe_subscription_id) {
      return json({
        // 해지 예약분은 전환도 막혀 있다(R-2) — 만기 후 시작하라고 정확히 안내한다.
        error: prev.cancel_at_period_end
          ? "해지 예약 중인 해외카드(Stripe) 구독이 있습니다. 남은 이용 기간이 끝난 뒤 국내카드로 시작할 수 있습니다."
          : "해외카드(Stripe) 구독이 이용 중입니다. 결제 수단 탭의 '국내카드로 전환'을 사용해 주세요.",
        code: "STRIPE_ACTIVE",
      }, 409);
    }
    // 남은 유료 기간(운영자 부여 등 Stripe 미연결)은 이미 결제된 것 — 만기부터 토스가 잇는다.
    const takeover = prevRemaining;

    // 남은 기간 인계는 같은 값 이하의 플랜만 — 상위 플랜을 넣으면 남은 기간을 무과금
    // 업그레이드로 쓰게 된다 (2026-08-14 보안 리뷰 H-1).
    if (takeover && prev!.plan_id && prev!.plan_id !== startPlan.id) {
      const { data: prevPlan } = await supabase
        .from("subscription_plans").select("base_price").eq("id", prev!.plan_id).maybeSingle();
      if (!prevPlan || Number(startPlan.base_price) > Number(prevPlan.base_price)) {
        return json({ error: "남은 이용 기간 동안에는 더 높은 플랜으로 바꿀 수 없습니다. 기간 종료 후 다시 시도해 주세요." }, 400);
      }
    }

    // 첫 결제 orderId 를 여기서 확정해 구독 행 마커에 함께 심는다 (보안 리뷰 R-1) —
    //   엣지가 결제 후·기록 전에 죽어도 cron 회수가 "같은 키"로 재요청해 토스 멱등키가
    //   원래 응답(성공이면 성공)을 돌려주고, 그걸로 인보이스·주기를 마저 채운다.
    //   접미사 -rN: 실패 후 같은 날 재시도가 소진된 키에 막히지 않게 실패 횟수를 붙인다.
    //   동시 더블클릭은 같은 N 을 읽어 같은 키 → 승인은 1회.
    let startOrderId: string | null = null;
    if (!takeover) {
      let oid = `ov-${String(callerCompanyId).replace(/-/g, "").slice(0, 12)}-${periodTag(new Date(nowIso))}`;
      const { count: failCnt } = await supabase
        .from("billing_events").select("id", { count: "exact", head: true })
        .eq("company_id", callerCompanyId).eq("event_type", "payment_failed")
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
      if (failCnt) oid = `${oid}-r${failCnt}`;
      startOrderId = oid;
    }

    const patch: Record<string, unknown> = {
      plan_id: startPlan.id,
      plan_slug: startPlan.slug,
      billing_cycle: billingCycle,
      status: "active",
      payment_provider: "toss",
      current_period_start: takeover ? prev!.current_period_start : nowIso,
      current_period_end: takeover ? prev!.current_period_end : nowIso,
      cancel_at_period_end: false,
      cancel_requested_at: null,
      cancel_reason: null,
      canceled_at: null,
      trial_ends_at: null,
      // 남은 Stripe 구독 id 를 지운다 — 만기 삭제 웹훅이 이 행을 Free 로 끌어내리지 못하게.
      stripe_subscription_id: null,
      payment_retry_count: 0,
      next_retry_at: null,
      // 결제 전 사망 대비 마커(즉시 결제 경로만) — 성공하면 아래 공용 루프가 null 로 지운다.
      // 남아 있으면 current_period_end=now 라 다음 cron(due)이 주워, 마커 안의 orderId
      // 그대로 재요청해 결제를 마무리한다 (M-3·R-1).
      last_payment_error: takeover ? null : `start_in_progress:${startOrderId}`,
      updated_at: nowIso,
    };

    if (prev) {
      const restore: Record<string, unknown> = {};
      for (const k of Object.keys(patch)) restore[k] = (prev as Record<string, unknown>)[k] ?? null;
      const { error: upErr } = await supabase.from("subscriptions").update(patch).eq("id", prev.id);
      if (upErr) { console.error("start sub update failed:", upErr.message); return json({ error: "구독 준비에 실패했습니다. 다시 시도해 주세요." }, 500); }
      startSubId = prev.id as string;
      startRollback = async () => { await supabase.from("subscriptions").update(restore).eq("id", prev.id); };
    } else {
      const { data: ins, error: insErr } = await supabase
        .from("subscriptions")
        .insert({ company_id: callerCompanyId, seat_count: 1, ...patch })
        .select("id").single();
      if (insErr) { console.error("start sub insert failed:", insErr.message); return json({ error: "구독 준비에 실패했습니다. 다시 시도해 주세요." }, 500); }
      startSubId = ins.id as string;
      startRollback = async () => { await supabase.from("subscriptions").delete().eq("id", ins.id); };
    }

    await supabase.from("billing_events").insert({
      company_id: callerCompanyId,
      event_type: "subscription_created",
      metadata: {
        provider: "toss", planSlug: startPlan.slug, billingCycle, takeover,
        previous: prev
          ? { id: prev.id, status: prev.status, provider: prev.payment_provider, stripeSubscriptionId: prev.stripe_subscription_id }
          : null,
      },
    });

    if (takeover) {
      return json({ ok: true, chargedNow: false, nextChargeAt: prev!.current_period_end });
    }
  }

  // ── 대상 구독 조회 ──
  let q = supabase
    .from("subscriptions")
    .select("id, company_id, plan_id, plan_slug, seat_count, billing_cycle, status, current_period_start, current_period_end, payment_retry_count, next_retry_at, cancel_at_period_end, last_payment_error")
    .eq("payment_provider", "toss")
    .in("status", ["active", "trialing", "past_due"]);

  if (mode === "one") {
    const target = isService ? body.companyId : callerCompanyId;
    if (!target) return json({ error: "companyId required" }, 400);
    q = q.eq("company_id", target);
  } else if (mode === "start") {
    q = q.eq("id", startSubId);
  } else {
    // 청구일이 지났고, 재시도 대기 중이 아닌 건만
    q = q.lte("current_period_end", nowIso);
  }

  const { data: subs, error: subErr } = await q;
  if (subErr) return json({ error: subErr.message }, 500);

  const targets = (subs || []).filter((s: any) =>
    mode === "one" || mode === "start" || !s.next_retry_at || s.next_retry_at <= nowIso
  );
  if (targets.length === 0) {
    if (mode === "start" && startRollback) {
      await startRollback();
      return json({ error: "구독 준비에 실패했습니다. 다시 시도해 주세요." }, 500);
    }
    return json({ ok: true, charged: 0, results: [] });
  }

  // 요금제는 한 번만 읽어 재사용
  const { data: plans } = await supabase
    .from("subscription_plans").select("id, slug, base_price, per_seat_price, included_seats, annual_discount");
  const planById = new Map((plans || []).map((p: any) => [p.id, p]));

  const results: ChargeOutcome[] = [];

  for (const s of targets as any[]) {
    // 해지 예약된 구독 — 청구하지 않는다 (2026-08-14: 해지 예약이 청구를 막지 못하던 구멍).
    //   기간이 끝난 cron 대상은 여기서 종료 처리하고, 수동 청구는 거절만 한다.
    if (s.cancel_at_period_end) {
      if (mode === "due") {
        await supabase.from("subscriptions").update({
          status: "canceled", canceled_at: nowIso, updated_at: nowIso,
        }).eq("id", s.id);
        await supabase.from("billing_events").insert({
          company_id: s.company_id, event_type: "subscription_ended",
          metadata: { provider: "toss", reason: "cancel_at_period_end" },
        });
        results.push({ companyId: s.company_id, ok: true, amount: 0 });
      } else {
        results.push({ companyId: s.company_id, ok: false, error: "해지 예약된 구독입니다." });
      }
      continue;
    }

    const plan = planById.get(s.plan_id);
    if (!plan) { results.push({ companyId: s.company_id, ok: false, error: "요금제를 찾을 수 없습니다" }); continue; }

    // ── 좌석 수를 실제 인원으로 맞춘다 (2026-08-07) ──
    //   지금까지 seat_count 는 결제 시점 값으로 굳어 있었다 — 5명일 때 결제한 회사가
    //   20명이 돼도 계속 5명 요금을 냈다. 청구 시점의 재직 인원으로 다시 센다.
    const includedSeats = plan.included_seats ?? 0;
    const perSeatMonthly = Number(plan.per_seat_price);
    const oldSeats = s.seat_count || 1;
    const yearly = s.billing_cycle === "yearly" || s.billing_cycle === "annual";
    // 좌석 1개의 "이번 주기" 값 — 연간이면 12개월치에 할인 적용.
    //   일할계산도 이 값을 기준으로 해야 한다(월 단가로 나누면 연간 구독이 12배 적게 정산된다).
    const perSeatPeriod = yearly
      ? Math.round(perSeatMonthly * 12 * (1 - Number(plan.annual_discount || 0)))
      : perSeatMonthly;
    const { count: empCount } = await supabase
      .from("employees").select("id", { count: "exact", head: true })
      .eq("company_id", s.company_id).in("status", ["active", "joined"]);
    const actualSeats = Math.max(1, empCount || 0);

    // 지난 주기 도중 좌석이 늘면 일할 가산, 줄면 일할 감액한다(2026-08-07 감액 추가).
    //   가산 기준은 등록일, 감액 기준은 퇴사일(employees.resignation_date).
    //   퇴사일이 비어 있으면 감액하지 않는다 — 날짜를 모르면 과다 환급이 되므로 보수적으로.
    let prorationAmount = 0; // 가산(+) · 감액(−) 합계
    const prorationDetail: { employeeId: string; days: number; amount: number; kind: "add" | "credit" }[] = [];
    const billableBefore = Math.max(0, oldSeats - includedSeats);
    const billableNow = Math.max(0, actualSeats - includedSeats);
    const pStartMs = s.current_period_start ? new Date(s.current_period_start).getTime() : null;
    const pEndMs = new Date(s.current_period_end || nowIso).getTime();
    const periodDays = pStartMs ? Math.max(1, Math.round((pEndMs - pStartMs) / 86400000)) : 0;
    const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

    if (perSeatPeriod > 0 && pStartMs && periodDays > 0) {
      const delta = billableNow - billableBefore;
      if (delta > 0) {
        // 늘어난 좌석 — 지난 주기에 새로 들어온 재직자 중 최근 등록분이 추가 과금 대상
        const { data: newcomers } = await supabase
          .from("employees").select("id, created_at")
          .eq("company_id", s.company_id).in("status", ["active", "joined"])
          .gte("created_at", new Date(pStartMs).toISOString())
          .order("created_at", { ascending: false })
          .limit(delta);
        for (const e of (newcomers || []) as { id: string; created_at: string }[]) {
          const days = Math.max(0, Math.round((pEndMs - new Date(e.created_at).getTime()) / 86400000));
          const amt = Math.round(perSeatPeriod * (days / periodDays));
          if (amt > 0) { prorationAmount += amt; prorationDetail.push({ employeeId: e.id, days, amount: amt, kind: "add" }); }
        }
      } else if (delta < 0) {
        // 줄어든 좌석 — 지난 주기에 퇴사한 인원의 "쓰지 않은 기간"만큼 돌려준다
        const { data: leavers } = await supabase
          .from("employees").select("id, resignation_date")
          .eq("company_id", s.company_id)
          .not("resignation_date", "is", null)
          .gte("resignation_date", ymd(pStartMs))
          .lte("resignation_date", ymd(pEndMs))
          .order("resignation_date", { ascending: false })
          .limit(-delta);
        for (const e of (leavers || []) as { id: string; resignation_date: string }[]) {
          const leftMs = new Date(`${e.resignation_date}T00:00:00Z`).getTime();
          const days = Math.max(0, Math.round((pEndMs - leftMs) / 86400000));
          const amt = Math.round(perSeatPeriod * (days / periodDays));
          if (amt > 0) { prorationAmount -= amt; prorationDetail.push({ employeeId: e.id, days, amount: -amt, kind: "credit" }); }
        }
      }
    }

    // 무료 플랜은 청구 대상이 아니다 — 주기만 다음으로 밀어 둔다.
    const supplyMonthly = Math.round(Number(plan.base_price) + billableNow * perSeatMonthly);
    const supplyBase = yearly
      ? Math.round(supplyMonthly * 12 * (1 - Number(plan.annual_discount || 0)))
      : supplyMonthly;
    // 감액이 이번 청구액보다 크면 0 으로 막는다(음수 결제는 불가) — 남은 감액은 기록만 남긴다.
    const supplyRaw = supplyBase + prorationAmount;
    const supply = Math.max(0, supplyRaw);
    const creditUnapplied = supply - supplyRaw;
    const periodStart = new Date(s.current_period_end || nowIso);
    const periodEnd = addPeriod(periodStart, s.billing_cycle || "monthly");

    if (supply <= 0) {
      await supabase.from("subscriptions").update({
        seat_count: actualSeats,
        current_period_start: periodStart.toISOString(),
        current_period_end: periodEnd.toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", s.id);
      // 감액으로 전액 상쇄된 경우도 흔적을 남긴다 — 왜 이번 달 청구가 없었는지 나중에 설명할 수 있게
      if (prorationAmount !== 0 || creditUnapplied > 0) {
        await supabase.from("billing_events").insert({
          company_id: s.company_id, event_type: "payment_success",
          metadata: { orderId: null, amount: 0, provider: "toss", seats: actualSeats,
            previousSeats: oldSeats, proration: prorationAmount, prorationDetail, creditUnapplied },
        });
      }
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
    let orderId = `ov-${String(s.company_id).replace(/-/g, "").slice(0, 12)}-${periodTag(periodStart)}`;
    if (mode === "start" && startOrderId) {
      // 첫 결제 — start 블록에서 확정해 마커에 심어 둔 키를 그대로 쓴다 (M-1·R-1).
      orderId = startOrderId;
    } else if (typeof s.last_payment_error === "string" && s.last_payment_error.startsWith("start_in_progress:")) {
      // 첫 결제 도중 죽은 행의 회수 — 그때 쓰던 키를 재사용해야 이중 출금이 안 된다 (R-1).
      orderId = s.last_payment_error.slice("start_in_progress:".length) || orderId;
    }
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
      // fetch 오류 메시지에는 요청 URL(빌링키 포함)이 통째로 들어간다 — 마스킹 후 기록 (M-4).
      console.error("toss charge call failed:", String((e as Error)?.message || e).split(billingKey).join("***"));
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
        description: prorationAmount > 0
          ? `${orderName} (좌석 ${actualSeats}명, 중도 합류 일할 ${prorationAmount.toLocaleString("ko-KR")}원 가산)`
          : prorationAmount < 0
            ? `${orderName} (좌석 ${actualSeats}명, 중도 퇴사 일할 ${Math.abs(prorationAmount).toLocaleString("ko-KR")}원 감액)`
            : `${orderName} (좌석 ${actualSeats}명)`,
        billing_period_start: periodStart.toISOString(),
        billing_period_end: periodEnd.toISOString(),
        currency: "krw",
      });
      await supabase.from("subscriptions").update({
        status: "active",
        seat_count: actualSeats,
        current_period_start: periodStart.toISOString(),
        current_period_end: periodEnd.toISOString(),
        payment_retry_count: 0,
        next_retry_at: null,
        last_payment_error: null,
        updated_at: new Date().toISOString(),
      }).eq("id", s.id);
      await supabase.from("billing_events").insert({
        company_id: s.company_id, event_type: "payment_success",
        metadata: { orderId, amount: total, paymentKey: payment.paymentKey, provider: "toss",
          seats: actualSeats, previousSeats: oldSeats, proration: prorationAmount, prorationDetail, creditUnapplied },
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
    // start 실패는 아래서 즉시 화면에 보여주고 구독을 되돌린다 — "3일 뒤 재시도" 알림은 갱신 결제만.
    if (mode !== "start") await notifyPaymentFailed(supabase, s.company_id, total, failMsg, exhausted);
    results.push({ companyId: s.company_id, ok: false, error: failMsg, code: failCode });
  }

  // ── start 마무리: 첫 결제가 실패하면 구독 행을 원상복구한다 ──
  if (mode === "start") {
    const r = results[0];
    if (!r?.ok) {
      if (startRollback) await startRollback();
      return json({ ok: false, error: r?.error || "결제에 실패했습니다.", code: r?.code || null }, 402);
    }
    return json({ ok: true, chargedNow: true, amount: r.amount });
  }

  return json({ ok: true, charged: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
}));
