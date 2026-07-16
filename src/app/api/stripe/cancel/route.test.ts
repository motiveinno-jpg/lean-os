// 구독 해지 라우트 — "해지해도 Stripe 청구 지속" 재발 방지 (2026-07-16 🔴3 수정분 회귀 테스트).
//   핵심 불변식: Stripe 구독이면 반드시 stripe.subscriptions.update(cancel_at_period_end) 실호출 +
//   DB 는 기간말 해지(cancelling). 즉시 canceled 는 Stripe 없는 체험/무료만.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = {
    authUser: null as Row | null,
    userRow: null as Row | null,
    sub: null as Row | null,
    updated: [] as { table: string; row: Row }[],
    inserted: [] as { table: string; row: Row }[],
    updateError: null as { message: string } | null,
    stripeUpdate: vi.fn(),
  };
  function chain(table: string) {
    const s: any = { op: "select", row: null };
    const respond = () => {
      if (s.op === "insert") { state.inserted.push({ table, row: s.row }); return { data: null, error: null }; }
      if (s.op === "update") {
        state.updated.push({ table, row: s.row });
        return { data: null, error: table === "subscriptions" ? state.updateError : null };
      }
      if (table === "users") return { data: state.userRow, error: null };
      if (table === "subscriptions") return { data: state.sub, error: null };
      return { data: null, error: null };
    };
    const api: any = {
      select: () => api, insert: (r: Row) => { s.op = "insert"; s.row = r; return api; },
      update: (r: Row) => { s.op = "update"; s.row = r; return api; },
      eq: () => api, in: () => api, order: () => api, limit: () => api, maybeSingle: () => api,
      then: (res: any, rej: any) => Promise.resolve(respond()).then(res, rej),
    };
    return api;
  }
  return { state, chain };
});

vi.mock("stripe", () => ({
  default: class MockStripe {
    subscriptions = { update: h.state.stripeUpdate };
  },
}));
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.state.authUser } }) },
  }),
}));
vi.mock("@/lib/supabase-admin", () => ({
  createSupabaseAdminClient: () => ({ from: (t: string) => h.chain(t) }),
}));

process.env.STRIPE_SECRET_KEY = "sk_test_x";

import { POST } from "./route";

const st = h.state;

const makeRequest = (body: Record<string, any> = {}) =>
  new Request("http://localhost/api/stripe/cancel", {
    method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  }) as any;

beforeEach(() => {
  st.authUser = { id: "auth-1" };
  st.userRow = { company_id: "co-1", role: "owner" };
  st.sub = null;
  st.updated = []; st.inserted = [];
  st.updateError = null;
  st.stripeUpdate.mockReset().mockResolvedValue({});
});

describe("권한 게이트", () => {
  it("미인증이면 401, Stripe 미호출", async () => {
    st.authUser = null;
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(st.stripeUpdate).not.toHaveBeenCalled();
  });

  it("owner/admin 아니면 403", async () => {
    st.userRow = { company_id: "co-1", role: "member" };
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect(st.stripeUpdate).not.toHaveBeenCalled();
  });

  it("회사 정보 없으면 403", async () => {
    st.userRow = null;
    expect((await POST(makeRequest())).status).toBe(403);
  });
});

describe("해지 흐름", () => {
  it("Stripe 구독이면 실취소(cancel_at_period_end) 호출 + DB cancelling", async () => {
    st.sub = { id: "sub-1", company_id: "co-1", stripe_subscription_id: "sub_stripe_1", plan_slug: "basic", status: "active" };
    const res = await POST(makeRequest({ reason: "비쌈" }));
    expect(res.status).toBe(200);
    expect(st.stripeUpdate).toHaveBeenCalledWith("sub_stripe_1", { cancel_at_period_end: true });
    const up = st.updated.find((u) => u.table === "subscriptions");
    expect(up?.row.status).toBe("cancelling");
    expect(up?.row.cancel_reason).toBe("비쌈");
    expect(st.inserted.find((i) => i.table === "billing_events")?.row.event_type).toBe("subscription_cancel_requested");
  });

  it("immediate 여도 Stripe 구독이면 즉시 canceled 로 내리지 않는다(기간말 해지 강제)", async () => {
    st.sub = { id: "sub-1", company_id: "co-1", stripe_subscription_id: "sub_stripe_1", plan_slug: "basic", status: "active" };
    await POST(makeRequest({ immediate: true }));
    const up = st.updated.find((u) => u.table === "subscriptions");
    expect(up?.row.status).toBe("cancelling");
  });

  it("Stripe 없는 체험/무료 + immediate 면 즉시 canceled, Stripe 미호출", async () => {
    st.sub = { id: "sub-1", company_id: "co-1", stripe_subscription_id: null, plan_slug: "free", status: "trialing" };
    const res = await POST(makeRequest({ immediate: true }));
    expect(res.status).toBe(200);
    expect(st.stripeUpdate).not.toHaveBeenCalled();
    const up = st.updated.find((u) => u.table === "subscriptions");
    expect(up?.row.status).toBe("canceled");
    expect(up?.row.canceled_at).toBeTruthy();
  });

  it("해지할 구독이 없으면 404", async () => {
    expect((await POST(makeRequest())).status).toBe(404);
  });

  it("Stripe 취소 실패 시 500 — DB 를 canceled/cancelling 로 바꾸지 않는다", async () => {
    st.sub = { id: "sub-1", company_id: "co-1", stripe_subscription_id: "sub_stripe_1", plan_slug: "basic", status: "active" };
    st.stripeUpdate.mockRejectedValueOnce(new Error("stripe down"));
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(st.updated.filter((u) => u.table === "subscriptions")).toHaveLength(0);
  });
});
