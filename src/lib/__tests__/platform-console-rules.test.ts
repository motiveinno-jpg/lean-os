import { describe, it, expect } from "vitest";
import { kstMonthKey, kstMonthsBack, kstDayStartMs, kstDayLabel, kstHourLabel } from "@/app/platform/_components/kst-bucket";
import { planOf, countPlanKinds } from "@/app/platform/_components/plan-kind";
import { judgeDependencies, type DepsHealthRpc } from "@/app/platform/_components/dependency-status";

describe("kst-bucket", () => {
  it("KST 1일 00~09시는 UTC 로 전달이지만 KST 달로 묶인다", () => {
    // 2026-10-01 03:00 KST = 2026-09-30 18:00 UTC
    expect(kstMonthKey("2026-09-30T18:00:00Z")).toBe("2026-10");
    expect(kstMonthKey("2026-09-30T14:59:59Z")).toBe("2026-09");
    expect(kstMonthKey(null)).toBe("");
  });
  it("몇 달 전 키는 KST 기준으로 연도를 넘긴다", () => {
    const now = Date.parse("2026-01-01T00:30:00+09:00"); // UTC 로는 아직 2025-12-31
    expect(kstMonthsBack(0, now)).toEqual({ key: "2026-01", name: "1월" });
    expect(kstMonthsBack(1, now)).toEqual({ key: "2025-12", name: "12월" });
    expect(kstMonthsBack(12, now)).toEqual({ key: "2025-01", name: "1월" });
  });
  it("하루 묶음은 KST 자정에서 끊는다", () => {
    const start = kstDayStartMs("2026-09-29T20:00:00Z")!; // KST 9/30 05:00
    expect(new Date(start).toISOString()).toBe("2026-09-29T15:00:00.000Z"); // KST 9/30 00:00
    expect(kstDayLabel(start)).toBe("9/30");
    expect(kstHourLabel("2026-09-29T20:10:00Z")).toBe("9/30 05시");
  });
});

describe("plan-kind (유료 판정 한 곳)", () => {
  const plan = (slug: string) => ({ slug, name: slug.toUpperCase() });
  const now = Date.parse("2026-09-29T00:00:00Z");
  it("실결제 구독만 유료 — 결제 수단 없는 활성 구독은 무상 이용", () => {
    expect(planOf({ subscriptions: [{ status: "active", subscription_plans: plan("standard"), toss_billing_key: "k" }] }, now).kind).toBe("paid");
    expect(planOf({ subscriptions: [{ status: "active", subscription_plans: plan("standard"), stripe_subscription_id: "sub_1" }] }, now).kind).toBe("paid");
    expect(planOf({ subscriptions: [{ status: "active", subscription_plans: plan("standard") }] }, now).kind).toBe("granted");
  });
  it("해지만 남은 회사·무료 요금제는 미구독, 미납은 따로", () => {
    expect(planOf({ subscriptions: [{ status: "canceled", subscription_plans: plan("standard"), toss_billing_key: "k" }] }, now).kind).toBe("free");
    expect(planOf({ subscriptions: [{ status: "active", subscription_plans: plan("free"), toss_billing_key: "k" }] }, now).kind).toBe("free");
    expect(planOf({ subscriptions: [{ status: "past_due", subscription_plans: plan("standard"), toss_billing_key: "k" }] }, now).kind).toBe("past_due");
    expect(planOf({}, now).kind).toBe("free");
  });
  it("체험은 끝난 날짜를 본다", () => {
    expect(planOf({ subscriptions: [{ status: "trialing", trial_ends_at: "2026-09-28T00:00:00Z", subscription_plans: plan("standard") }] }, now).kind).toBe("expired");
    const t = planOf({ subscriptions: [{ status: "trialing", trial_ends_at: "2026-10-02T00:00:00Z", subscription_plans: plan("standard") }] }, now);
    expect(t.kind).toBe("trial");
    expect(t.label).toBe("체험 D-3");
  });
  it("구독이 여럿이면 활성 > 미납 > 체험, 같으면 최근", () => {
    const c = { subscriptions: [
      { status: "trialing", trial_ends_at: "2026-10-10T00:00:00Z", created_at: "2026-09-20", subscription_plans: plan("standard") },
      { status: "active", created_at: "2026-09-01", subscription_plans: plan("standard"), toss_billing_key: "k" },
      { status: "canceled", created_at: "2026-09-25", subscription_plans: plan("standard"), toss_billing_key: "k" },
    ] };
    expect(planOf(c, now).kind).toBe("paid");
  });
  it("세기는 같은 판정", () => {
    const counts = countPlanKinds([
      { subscriptions: [{ status: "active", subscription_plans: plan("standard"), toss_billing_key: "k" }] },
      { subscriptions: [{ status: "active", subscription_plans: plan("standard") }] },
      {},
    ], now);
    expect(counts).toEqual({ free: 1, trial: 0, expired: 0, paid: 1, past_due: 0, granted: 1 });
  });
});

describe("dependency-status (근거 없으면 확인 안 함)", () => {
  const base: DepsHealthRpc = {
    supabase: { errors_24h: 3, errors_1h: 0 },
    codef: { bank_tx_24h: 10, card_tx_24h: 5 },
    stripe: { paid_invoices_24h: 1, failed_invoices_24h: 0 },
    signatures: { approvals_24h: 0, fully_signed_24h: 0 },
    at: "2026-09-29T00:00:00Z",
  };
  it("발송 기록 집계가 없으면 메일·전자서명은 확인 안 함, 서버 점검 없으면 Vercel 도 확인 안 함", () => {
    const j = judgeDependencies(base, null);
    expect(j.resend.status).toBe("unchecked");
    expect(j.signatures.status).toBe("unchecked");
    expect(j.vercel.status).toBe("unchecked");
    expect(j.supabase.status).toBe("ok");
  });
  it("발송 기록이 있으면 판정한다", () => {
    const j = judgeDependencies({
      ...base,
      mail: { sent_24h: 0, failed_24h: 4 },
      signatures: { approvals_24h: 0, fully_signed_24h: 0, requests_sent_24h: 3, send_failures_24h: 1 },
    }, null);
    expect(j.resend.status).toBe("down");
    expect(j.signatures.status).toBe("warn");
    const k = judgeDependencies({ ...base, mail: { sent_24h: 0, failed_24h: 0 }, signatures: { approvals_24h: 0, fully_signed_24h: 0, requests_sent_24h: 0, send_failures_24h: 0 } }, null);
    expect(k.resend.status).toBe("unchecked");
    expect(k.signatures.status).toBe("unchecked");
    const ok = judgeDependencies({ ...base, mail: { sent_24h: 50, failed_24h: 1 } }, null);
    expect(ok.resend.status).toBe("ok");
  });
  it("서버 점검 결과로 Vercel·Stripe API 를 판정한다", () => {
    const up = judgeDependencies(base, { reached: true, httpStatus: 200, ms: 120, body: { status: "healthy", checks: { stripe: { ok: true, ms: 80 } } } });
    expect(up.vercel.status).toBe("ok");
    expect(up.stripe.status).toBe("ok");
    const stripeDown = judgeDependencies(base, { reached: true, httpStatus: 200, ms: 120, body: { status: "degraded", checks: { stripe: { ok: false } } } });
    expect(stripeDown.stripe.status).toBe("down");
    // DB 가 죽어 503 이어도 우리 경로가 JSON 으로 답했으면 서버(Vercel)는 살아 있다
    const dbDown = judgeDependencies(base, { reached: true, httpStatus: 503, ms: 90, body: { status: "unhealthy" } });
    expect(dbDown.vercel.status).toBe("ok");
    expect(judgeDependencies(base, { reached: false }).vercel.status).toBe("down");
  });
});
