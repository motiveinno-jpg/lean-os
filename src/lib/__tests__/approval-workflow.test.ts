// 결재 워크플로우 엔진 — createApprovalRequest 의 결재선 판정 로직 회귀 방지.
//   정책 매칭/기본 폴백, 금액별 자동승인, 커스텀 결재선 단계명, 역할→승인자 해석·폴백.
//   supabase 는 체이너블 mock (insert 기록 → 단언).
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = {
    policies: [] as Row[],          // entity_type = 요청 유형 매칭 결과
    defaultPolicies: [] as Row[],   // entity_type = 'default' 폴백
    usersByRole: {} as Record<string, Row[]>,
    fallbackUsers: [] as Row[],     // role in ('ceo','admin','owner') 폴백 조회 결과
    inserted: [] as { table: string; row: Row }[],
  };
  function chain(table: string) {
    const s: any = { op: "select", filters: [] as { col: string; val: any; op: string }[], insertRow: null };
    const respond = (): { data: any; error: null } => {
      if (s.op === "insert") {
        state.inserted.push({ table, row: s.insertRow });
        if (table === "approval_requests") return { data: { id: "req-1", ...s.insertRow }, error: null };
        return { data: null, error: null };
      }
      if (s.op === "update") return { data: null, error: null };
      if (table === "approval_policies") {
        const et = s.filters.find((f: any) => f.op === "eq" && f.col === "entity_type")?.val;
        return { data: et === "default" ? state.defaultPolicies : state.policies, error: null };
      }
      if (table === "users") {
        const inF = s.filters.find((f: any) => f.op === "in" && f.col === "role");
        if (inF) return { data: state.fallbackUsers, error: null };
        const role = s.filters.find((f: any) => f.op === "eq" && f.col === "role")?.val;
        return { data: state.usersByRole[role] || [], error: null };
      }
      if (table === "approval_steps") {
        // 알림용 stage 1 승인자 조회
        const rows = state.inserted
          .filter((i) => i.table === "approval_steps" && i.row.stage === 1)
          .map((i) => ({ approver_id: i.row.approver_id }));
        return { data: rows, error: null };
      }
      return { data: [], error: null };
    };
    const api: any = {
      select: () => api,
      insert: (row: Row) => { s.op = "insert"; s.insertRow = row; return api; },
      update: () => { s.op = "update"; return api; },
      eq: (col: string, val: any) => { s.filters.push({ col, val, op: "eq" }); return api; },
      in: (col: string, val: any) => { s.filters.push({ col, val, op: "in" }); return api; },
      limit: () => api,
      single: () => api,
      then: (res: any, rej: any) => Promise.resolve(respond()).then(res, rej),
    };
    return api;
  }
  return { state, chain };
});

vi.mock("@/lib/supabase", () => ({ supabase: { from: (t: string) => h.chain(t) } }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/payment-queue", () => ({ createQueueEntry: vi.fn() }));
vi.mock("@/lib/routing", () => ({ resolveBank: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));

import { createApprovalRequest } from "@/lib/approval-workflow";
import { createNotification } from "@/lib/notifications";

const mockNotify = vi.mocked(createNotification);
const st = h.state;

const TWO_STAGE_POLICY = {
  id: "pol-1",
  auto_approve_below: 100_000,
  stages: [
    { stage: 1, name: "팀장 승인", approver_role: "manager", required_count: 1 },
    { stage: 2, name: "최종 승인", approver_role: "ceo", required_count: 1 },
  ],
};

const base = { companyId: "co-1", requesterId: "user-req", title: "테스트 결재" };
const steps = () => st.inserted.filter((i) => i.table === "approval_steps").map((i) => i.row);
const requestRow = () => st.inserted.find((i) => i.table === "approval_requests")!.row;

beforeEach(() => {
  st.policies = [];
  st.defaultPolicies = [];
  st.usersByRole = {};
  st.fallbackUsers = [];
  st.inserted.length = 0;
  mockNotify.mockReset();
});

describe("createApprovalRequest — 자동승인 임계값", () => {
  it("정책 임계값 미만 금액 → 즉시 승인, 결재 스텝·알림 없음", async () => {
    st.policies = [TWO_STAGE_POLICY];
    const r = await createApprovalRequest({ ...base, requestType: "expense", amount: 50_000 });
    expect(requestRow().status).toBe("approved");
    expect(requestRow().current_stage).toBe(2); // totalStages 로 점프
    expect(steps()).toHaveLength(0);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(r.id).toBe("req-1");
  });

  it("임계값 이상(같음 포함) → pending + 단계별 스텝 생성 + 1단계 승인자 알림", async () => {
    st.policies = [TWO_STAGE_POLICY];
    st.usersByRole = { manager: [{ id: "u-mgr", name: "팀장" }], ceo: [{ id: "u-ceo", name: "대표" }] };
    await createApprovalRequest({ ...base, requestType: "expense", amount: 100_000 });
    expect(requestRow().status).toBe("pending");
    expect(requestRow().total_stages).toBe(2);
    expect(steps()).toEqual([
      expect.objectContaining({ stage: 1, stage_name: "팀장 승인", approver_id: "u-mgr", status: "pending" }),
      expect.objectContaining({ stage: 2, stage_name: "최종 승인", approver_id: "u-ceo", status: "pending" }),
    ]);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify.mock.calls[0][0]).toMatchObject({ userId: "u-mgr", type: "approval_request" });
  });

  it("auto_approve_below 0(비활성) → 소액도 pending", async () => {
    st.policies = [{ ...TWO_STAGE_POLICY, auto_approve_below: 0 }];
    st.usersByRole = { manager: [{ id: "u-mgr" }], ceo: [{ id: "u-ceo" }] };
    await createApprovalRequest({ ...base, requestType: "expense", amount: 1 });
    expect(requestRow().status).toBe("pending");
  });
});

describe("createApprovalRequest — 커스텀 결재선", () => {
  it("2명 지정 → '1차 승인'·'최종 승인' 단계명, 정책 무시하고 지정 순서대로", async () => {
    await createApprovalRequest({
      ...base, requestType: "expense", amount: 500_000,
      customApprovers: [{ userId: "u-a", name: "A" }, { userId: "u-b", name: "B" }],
    });
    expect(steps()).toEqual([
      expect.objectContaining({ stage: 1, stage_name: "1차 승인", approver_id: "u-a" }),
      expect.objectContaining({ stage: 2, stage_name: "최종 승인", approver_id: "u-b" }),
    ]);
  });

  it("1명 지정 → 단계명 '최종 승인' 하나", async () => {
    await createApprovalRequest({
      ...base, requestType: "expense", amount: 500_000,
      customApprovers: [{ userId: "u-solo", name: "S" }],
    });
    expect(steps()).toEqual([expect.objectContaining({ stage: 1, stage_name: "최종 승인", approver_id: "u-solo" })]);
  });
});

describe("createApprovalRequest — 정책 폴백·승인자 해석", () => {
  it("유형 정책 없음 → default 정책 사용", async () => {
    st.defaultPolicies = [{ id: "pol-def", auto_approve_below: 0, stages: [{ stage: 1, name: "기본 승인", approver_role: "admin", required_count: 1 }] }];
    st.usersByRole = { admin: [{ id: "u-adm" }] };
    await createApprovalRequest({ ...base, requestType: "travel", amount: 10_000 });
    expect(steps()).toEqual([expect.objectContaining({ stage_name: "기본 승인", approver_id: "u-adm" })]);
  });

  it("정책 전무 → 내장 기본(최종 승인/ceo 1단계)", async () => {
    st.usersByRole = { ceo: [{ id: "u-ceo" }] };
    await createApprovalRequest({ ...base, requestType: "purchase", amount: 10_000 });
    expect(requestRow().total_stages).toBe(1);
    expect(steps()).toEqual([expect.objectContaining({ stage: 1, stage_name: "최종 승인", approver_id: "u-ceo" })]);
  });

  it("역할 보유자 없음 → ceo/admin/owner 폴백 조회로 배정", async () => {
    st.policies = [{ id: "p", auto_approve_below: 0, stages: [{ stage: 1, name: "재무 승인", approver_role: "finance", required_count: 1 }] }];
    st.fallbackUsers = [{ id: "u-owner" }];
    await createApprovalRequest({ ...base, requestType: "expense", amount: 10_000 });
    expect(steps()).toEqual([expect.objectContaining({ approver_id: "u-owner" })]);
  });

  it("폴백도 없음 → 요청자 본인에게 배정 (막다른 결재 방지)", async () => {
    st.policies = [{ id: "p", auto_approve_below: 0, stages: [{ stage: 1, name: "재무 승인", approver_role: "finance", required_count: 1 }] }];
    await createApprovalRequest({ ...base, requestType: "expense", amount: 10_000 });
    expect(steps()).toEqual([expect.objectContaining({ approver_id: "user-req" })]);
  });

  it("단계에 특정 인물(approver_id) 지정 시 역할 해석 없이 그 사람으로", async () => {
    st.policies = [{ id: "p", auto_approve_below: 0, stages: [{ stage: 1, name: "지정 승인", approver_id: "u-pick", required_count: 1 }] }];
    await createApprovalRequest({ ...base, requestType: "expense", amount: 10_000 });
    expect(steps()).toEqual([expect.objectContaining({ approver_id: "u-pick", stage_name: "지정 승인" })]);
  });
});
