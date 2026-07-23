// Stripe webhook 라우트 — 서명 게이트·멱등성·dunning 회귀 방지 (2026-07-16 하드닝 테스트 백로그).
//   실 Stripe/DB 없이 constructEvent 와 supabase admin 을 mock, insert/update 기록으로 단언.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = {
    plan: null as Row | null,             // subscription_plans .single()
    existingSub: null as Row | null,      // subscriptions maybeSingle (company_id 조회)
    subByStripeId: null as Row | null,    // subscriptions maybeSingle (stripe_subscription_id 조회)
    dupInvoice: null as Row | null,       // invoices stripe_invoice_id 멱등성 조회
    lastInvoice: null as Row | null,      // invoices like INV-... 마지막 번호 조회
    inserted: [] as { table: string; row: Row }[],
    updated: [] as { table: string; row: Row; filters: { col: string; val: any }[] }[],
    constructEvent: vi.fn(),
    // checkout.session.completed 가 조회하는 Stripe 구독(진실원천). 기본 trialing.
    stripeSub: {
      status: "trialing", trial_end: 1900000000,
      current_period_start: 1800000000, current_period_end: 1900000000,
      cancel_at_period_end: false,
    } as Row,
  };
  function chain(table: string) {
    const s: any = { op: "select", filters: [] as { col: string; val: any; op: string }[], row: null };
    const respond = (): { data: any; error: null } => {
      if (s.op === "insert") { state.inserted.push({ table, row: s.row }); return { data: null, error: null }; }
      if (s.op === "update") { state.updated.push({ table, row: s.row, filters: s.filters }); return { data: null, error: null }; }
      if (table === "subscription_plans") return { data: state.plan, error: null };
      if (table === "subscriptions") {
        const byStripe = s.filters.some((f: any) => f.col === "stripe_subscription_id");
        return { data: byStripe ? state.subByStripeId : state.existingSub, error: null };
      }
      if (table === "invoices") {
        const byStripeInvoice = s.filters.some((f: any) => f.col === "stripe_invoice_id");
        return { data: byStripeInvoice ? state.dupInvoice : state.lastInvoice, error: null };
      }
      return { data: null, error: null };
    };
    const api: any = {
      select: () => api,
      insert: (row: Row) => { s.op = "insert"; s.row = row; return api; },
      update: (row: Row) => { s.op = "update"; s.row = row; return api; },
      eq: (col: string, val: any) => { s.filters.push({ col, val, op: "eq" }); return api; },
      in: (col: string, val: any) => { s.filters.push({ col, val, op: "in" }); return api; },
      like: (col: string, val: any) => { s.filters.push({ col, val, op: "like" }); return api; },
      order: () => api,
      limit: () => api,
      single: () => api,
      maybeSingle: () => api,
      then: (res: any, rej: any) => Promise.resolve(respond()).then(res, rej),
    };
    return api;
  }
  return { state, chain };
});

vi.mock("stripe", () => ({
  default: class MockStripe {
    webhooks = { constructEvent: h.state.constructEvent };
    subscriptions = { retrieve: async () => h.state.stripeSub };
  },
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: (t: string) => h.chain(t) }),
}));

process.env.STRIPE_SECRET_KEY = "sk_test_x";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service_x";

import { POST } from "./route";

const st = h.state;

function makeRequest(body = "{}", sig: string | null = "t=1,v1=sig") {
  const headers = new Headers();
  if (sig) headers.set("stripe-signature", sig);
  return new Request("http://localhost/api/stripe/webhook", { method: "POST", body, headers }) as any;
}

function arm(eventType: string, object: Record<string, any>) {
  st.constructEvent.mockReturnValue({ type: eventType, data: { object } });
}

beforeEach(() => {
  st.plan = null; st.existingSub = null; st.subByStripeId = null;
  st.dupInvoice = null; st.lastInvoice = null;
  st.inserted = []; st.updated = [];
  st.constructEvent.mockReset();
});

describe("서명 게이트", () => {
  it("stripe-signature 헤더 없으면 400 MISSING_SIGNATURE", async () => {
    const res = await POST(makeRequest("{}", null));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("MISSING_SIGNATURE");
  });

  it("서명 검증 실패면 400 INVALID_SIGNATURE — 핸들러 미실행", async () => {
    st.constructEvent.mockImplementation(() => { throw new Error("bad sig"); });
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_SIGNATURE");
    expect(st.inserted).toHaveLength(0);
  });
});

describe("checkout.session.completed", () => {
  const session = {
    id: "cs_1", subscription: "sub_1", customer: "cus_1",
    metadata: { companyId: "co-1", planSlug: "basic", seatCount: "7" },
  };

  it("기존 구독 있으면 update 경로(trialing) + billing_events 기록", async () => {
    st.plan = { id: "plan-1" };
    st.existingSub = { id: "sub-row-1" };
    arm("checkout.session.completed", session);
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const up = st.updated.find((u) => u.table === "subscriptions");
    // ⚠️ 즉시 active 금지 — Stripe 구독 상태(trialing)를 그대로 저장.
    expect(up?.row.status).toBe("trialing");
    expect(up?.row.trial_ends_at).toBeTruthy();
    expect(up?.row.seat_count).toBe(7);
    expect(up?.row.stripe_subscription_id).toBe("sub_1");
    expect(st.inserted.filter((i) => i.table === "subscriptions")).toHaveLength(0);
    // companies.current_plan 도 갱신
    expect(st.updated.find((u) => u.table === "companies")?.row.current_plan).toBe("basic");
    expect(st.inserted.find((i) => i.table === "billing_events")?.row.event_type).toBe("checkout_completed");
  });

  it("기존 구독 없으면 insert 경로(trialing)", async () => {
    st.plan = { id: "plan-1" };
    arm("checkout.session.completed", session);
    await POST(makeRequest());
    const ins = st.inserted.find((i) => i.table === "subscriptions");
    expect(ins?.row.company_id).toBe("co-1");
    expect(ins?.row.status).toBe("trialing");
    expect(ins?.row.seat_count).toBe(7);
  });

  it("metadata 누락이면 아무것도 안 쓴다", async () => {
    arm("checkout.session.completed", { id: "cs_2", metadata: {} });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(st.inserted).toHaveLength(0);
    expect(st.updated).toHaveLength(0);
  });
});

describe("invoice.paid — 멱등성·인보이스 번호", () => {
  const invoice = { id: "in_1", subscription: "sub_1", amount_paid: 5_500_000, lines: { data: [] } };

  it("같은 stripe_invoice_id 재수신(Stripe 재시도) 시 중복 insert 없음", async () => {
    st.subByStripeId = { id: "sub-row-1", company_id: "co-1" };
    st.dupInvoice = { id: "existing-invoice" };
    arm("invoice.paid", invoice);
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(st.inserted).toHaveLength(0);
  });

  it("첫 수신이면 invoices+billing_events 기록, 금액은 원화(/100)", async () => {
    st.subByStripeId = { id: "sub-row-1", company_id: "co-1" };
    arm("invoice.paid", invoice);
    await POST(makeRequest());
    const inv = st.inserted.find((i) => i.table === "invoices");
    expect(inv?.row.status).toBe("paid");
    expect(inv?.row.amount).toBe(55000);
    expect(inv?.row.invoice_number).toMatch(/^INV-\d{6}-0001$/);
    expect(st.inserted.find((i) => i.table === "billing_events")?.row.event_type).toBe("invoice_paid");
  });

  it("당월 마지막 번호 다음 시퀀스로 채번한다", async () => {
    st.subByStripeId = { id: "sub-row-1", company_id: "co-1" };
    st.lastInvoice = { invoice_number: "INV-209901-0007" };
    arm("invoice.paid", invoice);
    await POST(makeRequest());
    const inv = st.inserted.find((i) => i.table === "invoices");
    expect(inv?.row.invoice_number).toMatch(/-0008$/);
  });

  it("연결 구독 없으면 no-op", async () => {
    arm("invoice.paid", invoice);
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(st.inserted).toHaveLength(0);
  });
});

describe("invoice.payment_failed — dunning", () => {
  it("구독 past_due 전환 + payment_failed 이벤트 기록", async () => {
    st.subByStripeId = { id: "sub-row-1", company_id: "co-1" };
    arm("invoice.payment_failed", { id: "in_2", subscription: "sub_1", amount_due: 5_500_000, attempt_count: 2 });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const up = st.updated.find((u) => u.table === "subscriptions");
    expect(up?.row.status).toBe("past_due");
    const ev = st.inserted.find((i) => i.table === "billing_events");
    expect(ev?.row.event_type).toBe("payment_failed");
    expect(ev?.row.metadata.amountDue).toBe(55000);
  });
});

describe("customer.subscription.deleted", () => {
  it("구독 canceled 전환 (metadata companyId 없어도 상태 전환은 수행)", async () => {
    arm("customer.subscription.deleted", { id: "sub_1", metadata: {} });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const up = st.updated.find((u) => u.table === "subscriptions");
    expect(up?.row.status).toBe("canceled");
    expect(up?.row.canceled_at).toBeTruthy();
    expect(st.inserted).toHaveLength(0); // companyId 없으면 billing_events 생략
  });
});

describe("핸들러 내부 에러", () => {
  it("핸들러 throw 시 500 HANDLER_ERROR (Stripe 재시도 유도)", async () => {
    st.constructEvent.mockReturnValue({ type: "invoice.paid", data: { object: null } }); // null 접근으로 throw
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("HANDLER_ERROR");
  });
});
