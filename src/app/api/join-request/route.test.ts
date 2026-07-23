// 회사 합류 요청 생성 라우트 — 보안 가드 회귀 테스트(2026-07-23).
//   핵심 불변식: 미인증 이메일·이미 소속·미등록 번호는 요청 생성 전에 차단.
//   (사업자번호만 아는 외부인이 기존 회사에 붙는 것을 막는 1차 관문)
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    authUser: null as any,
    usersRow: null as any,   // callerRow (users by auth_id)
    company: null as any,    // companies by business_number
    inserted: [] as { table: string; row: any }[],
  };
  function chain(table: string): any {
    const api: any = {
      select: () => api, eq: () => api, in: () => api, gte: () => api,
      order: () => api, limit: () => api,
      insert: (row: any) => { state.inserted.push({ table, row }); return api; },
      update: () => api,
      maybeSingle: () => api,
      single: () => api,
      then: (res: any, rej: any) => {
        let data: any = null;
        if (table === "users") data = state.usersRow;
        else if (table === "companies") data = state.company;
        else if (table === "company_join_requests") data = null; // 가드 테스트는 CJR 조회 전에 종료
        return Promise.resolve({ data, error: null }).then(res, rej);
      },
    };
    return api;
  }
  return { state, chain };
});

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.state.authUser } }) } }),
}));
vi.mock("@/lib/supabase-admin", () => ({
  createSupabaseAdminClient: () => ({ from: (t: string) => h.chain(t) }),
}));

import { POST } from "./route";

const st = h.state;
const makeReq = (body: any = {}) =>
  new Request("http://localhost/api/join-request", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }) as any;

beforeEach(() => {
  st.authUser = { id: "auth-1", email: "u@x.com", email_confirmed_at: "2026-01-01T00:00:00Z", confirmed_at: "2026-01-01T00:00:00Z" };
  st.usersRow = null;
  st.company = null;
  st.inserted = [];
});

describe("합류 요청 생성 가드", () => {
  it("미인증(로그인 없음)이면 401", async () => {
    st.authUser = null;
    expect((await POST(makeReq({ businessNumber: "1234567890" }))).status).toBe(401);
  });

  it("이메일 미인증이면 403 — 요청 생성 안 함", async () => {
    st.authUser = { id: "auth-1", email: "u@x.com", email_confirmed_at: null, confirmed_at: null };
    const res = await POST(makeReq({ businessNumber: "1234567890" }));
    expect(res.status).toBe(403);
    expect(st.inserted.length).toBe(0);
  });

  it("사업자번호 10자리 아니면 400", async () => {
    expect((await POST(makeReq({ businessNumber: "123" }))).status).toBe(400);
  });

  it("이미 회사 소속이면 409 — 요청 생성 안 함", async () => {
    st.usersRow = { id: "u-1", company_id: "co-1" };
    const res = await POST(makeReq({ businessNumber: "1234567890" }));
    expect(res.status).toBe(409);
    expect(st.inserted.length).toBe(0);
  });

  it("미등록 사업자번호면 404", async () => {
    st.usersRow = null;      // 무소속
    st.company = null;       // 매칭 회사 없음
    const res = await POST(makeReq({ businessNumber: "1234567890" }));
    expect(res.status).toBe(404);
    expect(st.inserted.length).toBe(0);
  });
});
