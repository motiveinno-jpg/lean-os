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
    // 요청자 부서·직급 (2026-08-20 적용 대상별 규칙 매칭에서 조회) — user_id → {department, position}
    employeeByUser: {} as Record<string, Row>,
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
      if (table === "employees") {
        const uid = s.filters.find((f: any) => f.op === "eq" && f.col === "user_id")?.val;
        return { data: state.employeeByUser[uid] || null, error: null };
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
      maybeSingle: () => api,
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

import { createApprovalRequest, pickPolicyForRequester, policyTargets, policyRules, pickRuleForRequester, rulesNeedEmployeeInfo } from "@/lib/approval-workflow";
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
  st.employeeByUser = {};
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

// 정책 적용 대상 매칭 (2026-08-11) — 직원 복수(requester_ids)·팀(requester_department) 확장.
//   우선순위: 직원 지정 > 부서 > 회사 공통. requester_id(단일)는 하위호환으로 합집합 처리.
describe("pickPolicyForRequester — 대상 매칭 우선순위", () => {
  const all = { id: "all", requester_id: null, requester_ids: null, requester_department: null };
  const dept = { id: "dept", requester_id: null, requester_ids: null, requester_department: "디자인" };
  const users = { id: "users", requester_id: null, requester_ids: ["u1", "u2"], requester_department: null };
  const legacy = { id: "legacy", requester_id: "u3", requester_ids: null, requester_department: null };
  const cands = [all, dept, users, legacy];

  it("직원 지정이 부서·공통보다 우선", () => {
    expect(pickPolicyForRequester(cands, "u1", "디자인")?.id).toBe("users");
  });
  it("레거시 requester_id 단일 지정도 직원 지정으로 매칭", () => {
    expect(pickPolicyForRequester(cands, "u3", null)?.id).toBe("legacy");
  });
  it("직원 미지정이면 부서 일치 정책", () => {
    expect(pickPolicyForRequester(cands, "u9", "디자인")?.id).toBe("dept");
  });
  it("직원·부서 다 불일치면 회사 공통", () => {
    expect(pickPolicyForRequester(cands, "u9", "개발")?.id).toBe("all");
  });
  it("대상 지정 정책만 있고 불일치면 null (남의 전용 정책을 쓰지 않는다)", () => {
    expect(pickPolicyForRequester([dept, users], "u9", "개발")).toBeNull();
  });
  it("policyTargets — requester_ids 와 requester_id 합집합", () => {
    expect(policyTargets({ requester_id: "u3", requester_ids: ["u1"], requester_department: null }).userIds).toEqual(["u1", "u3"]);
  });
});

// 한 결재선 안의 적용 대상별 결재선·참조 (2026-08-20 사장님 요청).
//   우선순위: 특정 직원 > 팀(부서) > 직급 > 회사 전체. rules 가 없는 옛 정책은 규칙 1개로 읽힌다.
describe("policyRules / pickRuleForRequester — 적용 대상별 규칙", () => {
  const st = (name: string) => [{ stage: 1, name, approver_role: "manager" }];
  const rules = [
    { id: "r-users", target: { mode: "users" as const, userIds: ["u1", "u2"] }, stages: st("김대리선"), reference_user_ids: ["ref-u"] },
    { id: "r-dept", target: { mode: "department" as const, department: "디자인" }, stages: st("디자인선"), reference_user_ids: ["ref-d"] },
    { id: "r-pos", target: { mode: "position" as const, position: "사원" }, stages: st("사원선"), reference_user_ids: ["ref-p"] },
    { id: "r-all", target: { mode: "all" as const }, stages: st("기본선"), reference_user_ids: [] },
  ];

  it("특정 직원이 부서·직급·전체보다 우선", () => {
    expect(pickRuleForRequester(rules, "u1", "디자인", "사원")?.id).toBe("r-users");
  });
  it("직원 불일치면 부서", () => {
    expect(pickRuleForRequester(rules, "u9", "디자인", "사원")?.id).toBe("r-dept");
  });
  it("직원·부서 불일치면 직급", () => {
    expect(pickRuleForRequester(rules, "u9", "개발", "사원")?.id).toBe("r-pos");
  });
  it("전부 불일치면 '회사 전체' 기본 규칙", () => {
    expect(pickRuleForRequester(rules, "u9", "개발", "부장")?.id).toBe("r-all");
  });
  it("기본 규칙이 없고 아무 대상도 안 맞으면 null", () => {
    expect(pickRuleForRequester(rules.slice(0, 3), "u9", "개발", "부장")).toBeNull();
  });
  it("규칙마다 참조가 따로 걸린다", () => {
    expect(pickRuleForRequester(rules, "u9", "디자인", null)?.reference_user_ids).toEqual(["ref-d"]);
    expect(pickRuleForRequester(rules, "u1", null, null)?.reference_user_ids).toEqual(["ref-u"]);
  });

  it("policyRules — rules 없는 옛 정책은 기존 대상·단계·참조를 규칙 1개로 읽는다", () => {
    const legacy = policyRules({
      requester_id: null, requester_ids: ["u7"], requester_department: null, rules: null,
      stages: st("옛선") as never, reference_user_ids: ["ref-legacy"],
    });
    expect(legacy).toHaveLength(1);
    expect(legacy[0].target).toEqual({ mode: "users", userIds: ["u7"] });
    expect(legacy[0].reference_user_ids).toEqual(["ref-legacy"]);
    // 그 요청자에게 실제로 매칭되어 옛 결재선이 그대로 쓰인다
    expect(pickRuleForRequester(legacy, "u7", null, null)?.stages[0].name).toBe("옛선");
  });

  it("policyRules — 대상도 rules 도 없으면 '회사 전체' 규칙 1개", () => {
    const wide = policyRules({
      requester_id: null, requester_ids: null, requester_department: null, rules: null,
      stages: st("공통선") as never, reference_user_ids: [],
    });
    expect(wide[0].target.mode).toBe("all");
    expect(pickRuleForRequester(wide, "누구든", null, null)?.stages[0].name).toBe("공통선");
  });

  it("rulesNeedEmployeeInfo — 부서·직급 규칙이 있을 때만 직원 조회가 필요", () => {
    expect(rulesNeedEmployeeInfo(rules)).toBe(true);
    expect(rulesNeedEmployeeInfo([rules[0], rules[3]])).toBe(false);
  });
});

// 규칙이 '실제 결재 스텝'까지 이어지는지 — 여기가 깨지면 화면만 맞고 결재는 엉뚱한 사람에게 간다.
describe("createApprovalRequest — 적용 대상별 결재선이 실제 스텝에 반영", () => {
  // 결재선 하나에 대상 3개: 특정 직원(u-kim) 2단계 / 개발팀 1단계(재무) / 그 외 전체 1단계(팀장)
  const RULES_POLICY = {
    id: "pol-rules",
    auto_approve_below: 0,
    stages: [{ stage: 1, name: "팀장 승인", approver_role: "manager" }], // 거울(옛 경로용)
    reference_user_ids: [],
    requester_id: null, requester_ids: null, requester_department: null,
    rules: [
      { id: "r-users", target: { mode: "users", userIds: ["u-kim"] },
        stages: [{ stage: 1, name: "팀장 승인", approver_role: "manager" }, { stage: 2, name: "대표 승인", approver_role: "ceo" }],
        reference_user_ids: ["u-cc-a"] },
      { id: "r-dept", target: { mode: "department", department: "개발팀" },
        stages: [{ stage: 1, name: "재무 확인", approver_role: "finance" }], reference_user_ids: ["u-cc-b"] },
      { id: "r-all", target: { mode: "all" },
        stages: [{ stage: 1, name: "팀장 승인", approver_role: "manager" }], reference_user_ids: [] },
    ],
  };

  beforeEach(() => {
    st.usersByRole = {
      manager: [{ id: "u-mgr" }], ceo: [{ id: "u-ceo" }], finance: [{ id: "u-fin" }],
    };
  });

  it("특정 직원 대상 → 그 규칙의 2단계(팀장→대표)로 스텝 생성", async () => {
    st.policies = [RULES_POLICY];
    await createApprovalRequest({ ...base, requesterId: "u-kim", requestType: "expense", amount: 500_000 });
    expect(requestRow().total_stages).toBe(2);
    expect(steps()).toEqual([
      expect.objectContaining({ stage: 1, stage_name: "팀장 승인", approver_id: "u-mgr" }),
      expect.objectContaining({ stage: 2, stage_name: "대표 승인", approver_id: "u-ceo" }),
    ]);
  });

  it("부서 대상 → 직원 부서를 조회해 그 규칙의 1단계(재무)로", async () => {
    st.policies = [RULES_POLICY];
    st.employeeByUser = { "u-dev": { department: "개발팀", position: "주임" } };
    await createApprovalRequest({ ...base, requesterId: "u-dev", requestType: "expense", amount: 500_000 });
    expect(requestRow().total_stages).toBe(1);
    expect(steps()).toEqual([expect.objectContaining({ stage: 1, stage_name: "재무 확인", approver_id: "u-fin" })]);
  });

  it("어느 대상에도 안 걸리면 '그 외 전체' 규칙의 1단계", async () => {
    st.policies = [RULES_POLICY];
    st.employeeByUser = { "u-etc": { department: "마케팅", position: "사원" } };
    await createApprovalRequest({ ...base, requesterId: "u-etc", requestType: "expense", amount: 500_000 });
    expect(requestRow().total_stages).toBe(1);
    expect(steps()).toEqual([expect.objectContaining({ stage: 1, stage_name: "팀장 승인", approver_id: "u-mgr" })]);
  });

  it("참조를 안 넘긴 호출은 매칭된 규칙의 참조가 요청에 붙는다", async () => {
    st.policies = [RULES_POLICY];
    await createApprovalRequest({ ...base, requesterId: "u-kim", requestType: "expense", amount: 500_000 });
    expect(requestRow().reference_user_ids).toEqual(["u-cc-a"]);
  });

  it("요청자가 고른 참조가 있으면 그 값이 우선(규칙 참조로 덮어쓰지 않는다)", async () => {
    st.policies = [RULES_POLICY];
    await createApprovalRequest({ ...base, requesterId: "u-kim", requestType: "expense", amount: 500_000, referenceUserIds: ["u-picked"] });
    expect(requestRow().reference_user_ids).toEqual(["u-picked"]);
  });

  it("rules 없는 옛 정책은 종전대로 policy.stages 를 쓴다(회귀 방지)", async () => {
    st.policies = [TWO_STAGE_POLICY];
    await createApprovalRequest({ ...base, requestType: "expense", amount: 500_000 });
    expect(requestRow().total_stages).toBe(2);
    expect(steps()).toEqual([
      expect.objectContaining({ stage: 1, stage_name: "팀장 승인", approver_id: "u-mgr" }),
      expect.objectContaining({ stage: 2, stage_name: "최종 승인", approver_id: "u-ceo" }),
    ]);
  });
});
