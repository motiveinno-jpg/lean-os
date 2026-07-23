// 합류 요청 승인/거절 라우트 — 권한 게이트 + RPC 에러 매핑 회귀 테스트(2026-07-23).
//   원자적 처리는 DB RPC(resolve_company_join_request)가 담당 — 라우트는 권한 선검증 + 에러 HTTP 매핑.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    authUser: null as any,
    callerRow: null as any,   // users by auth_id
    rpcResult: null as any,   // resolve_company_join_request 반환
    rpcError: null as any,
    rpcArgs: null as any,     // RPC 에 전달된 파라미터 캡처
  };
  function chain(): any {
    const api: any = {
      select: () => api, eq: () => api, maybeSingle: () => api,
      then: (res: any, rej: any) => Promise.resolve({ data: state.callerRow, error: null }).then(res, rej),
    };
    return api;
  }
  return { state, chain };
});

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.state.authUser } }) } }),
}));
vi.mock("@/lib/supabase-admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => h.chain(),
    rpc: async (_name: string, args: any) => { h.state.rpcArgs = args; return { data: h.state.rpcResult, error: h.state.rpcError }; },
  }),
}));

import { POST } from "./route";

const st = h.state;
const makeReq = (body: any = {}) =>
  new Request("http://localhost/api/join-request/resolve", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }) as any;

beforeEach(() => {
  st.authUser = { id: "auth-1" };
  st.callerRow = { id: "u-owner", company_id: "co-1", role: "owner" };
  st.rpcResult = { ok: true, status: "approved", granted_role: "employee", requester_auth_id: "req-1" };
  st.rpcError = null;
});

describe("승인/거절 권한·매핑", () => {
  it("미인증이면 401", async () => {
    st.authUser = null;
    expect((await POST(makeReq({ requestId: "r1", action: "approve" }))).status).toBe(401);
  });

  it("owner/admin 아니면 403", async () => {
    st.callerRow = { id: "u-emp", company_id: "co-1", role: "employee" };
    expect((await POST(makeReq({ requestId: "r1", action: "approve" }))).status).toBe(403);
  });

  it("requestId/action 없으면 400", async () => {
    expect((await POST(makeReq({}))).status).toBe(400);
  });

  it("RPC 가 타회사 요청이면 403 매핑", async () => {
    st.rpcResult = { error: "forbidden_other_company" };
    expect((await POST(makeReq({ requestId: "r1", action: "approve" }))).status).toBe(403);
  });

  it("RPC 가 이미 처리됨이면 409 매핑", async () => {
    st.rpcResult = { error: "already_resolved", status: "approved" };
    expect((await POST(makeReq({ requestId: "r1", action: "approve" }))).status).toBe(409);
  });

  it("승인 성공 시 200 + status approved", async () => {
    const res = await POST(makeReq({ requestId: "r1", action: "approve", role: "employee" }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.status).toBe("approved");
    expect(j.role).toBe("employee");
  });

  it("body.role=owner 여도 RPC 엔 employee 로 전달(owner 승격 불가)", async () => {
    st.rpcArgs = null;
    await POST(makeReq({ requestId: "r1", action: "approve", role: "owner" }));
    expect(st.rpcArgs?.p_role).toBe("employee");
  });

  it("body.role=admin 은 admin 으로 전달", async () => {
    st.rpcArgs = null;
    await POST(makeReq({ requestId: "r1", action: "approve", role: "admin" }));
    expect(st.rpcArgs?.p_role).toBe("admin");
  });
});
