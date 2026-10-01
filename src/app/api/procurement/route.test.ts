import { beforeEach, describe, it, expect, vi } from "vitest";
import { fixtureWorkspace } from "@/lib/procurement/__tests__/fixtures";
import { ProcurementError } from "@/lib/procurement/validation";
const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  workspace: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  collect: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/lib/procurement/server", () => ({
  authorize: mocks.authorize,
  workspace: mocks.workspace,
  checked: (r: { data: unknown; error?: unknown }) => {
    if (r.error) throw new Error("db failed");
    return r.data;
  },
}));
vi.mock("@/lib/procurement/automation", () => ({
  collectForCompany: mocks.collect,
  sendDigest: mocks.send,
}));
import { GET, POST } from "./route";
const request = (body: unknown) =>
  new Request("https://www.owner-view.com/api/procurement", {
    method: "POST",
    headers: {
      origin: "https://www.owner-view.com",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    db: { from: mocks.from, rpc: mocks.rpc },
    companyId: "trusted-company",
    userId: "trusted-user",
  });
  mocks.workspace.mockResolvedValue(fixtureWorkspace());
  mocks.rpc.mockResolvedValue({ data: "id", error: null });
  mocks.from.mockReturnValue({
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
  });
});
describe("입찰 API의 회사·권한 경계", () => {
  it("실적 가져오기는 신뢰된 회사와 사용자로 일괄 저장한다", async () => {
    const w = fixtureWorkspace();
    const result = await POST(
      request({
        action: "import-evidence",
        bundle: {
          companyBusinessNumber: w.company.business_number,
          items: [w.evidence[1]],
        },
        companyId: "forged",
      }),
    );
    expect(result.status).toBe(200);
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe("procurement_import_evidence");
    expect(args.p_company).toBe("trusted-company");
    expect(args.p_user).toBe("trusted-user");
    expect(args.p_items[0].payload.verified).toBe(false);
    expect(args.p_items[0].import_key).toHaveLength(64);
  });
  it("다른 회사 실적 묶음은 저장하지 않는다", async () => {
    const result = await POST(
      request({
        action: "import-evidence",
        bundle: {
          companyBusinessNumber: "1111111111",
          items: [fixtureWorkspace().evidence[1]],
        },
      }),
    );
    expect(result.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("평가 당시 오너뷰 회사정보와 증빙 사본을 보존한다", async () => {
    const w = fixtureWorkspace();
    const result = await POST(
      request({
        action: "review",
        noticeId: w.notices[0].id,
        review: w.reviews[0].review,
        company: { name: "위조 회사" },
      }),
    );
    expect(result.status).toBe(200);
    const insert = mocks.from.mock.results[0].value.insert.mock.calls[0][0];
    expect(insert.basis_snapshot.company).toEqual(w.company);
    expect(insert.basis_snapshot.evidence).toEqual(w.evidence);
    expect(insert.company_id).toBe("trusted-company");
  });
  it("다른 회사 증빙의 검증을 철회할 수 없다", async () => {
    expect(
      (
        await POST(
          request({
            action: "revoke-evidence",
            evidenceId: "foreign",
            note: "철회",
          }),
        )
      ).status,
    ).toBe(404);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("이전 미리보기로 바뀐 메일을 발송할 수 없다", async () => {
    expect(
      (
        await POST(
          request({
            action: "send-digest",
            confirmSend: true,
            previewHash: "stale",
          }),
        )
      ).status,
    ).toBe(409);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("비인증 요청은 회사 자료를 읽지 않는다", async () => {
    mocks.authorize.mockRejectedValue(new ProcurementError("로그인 필요", 401));
    expect(
      (await GET(new Request("https://www.owner-view.com/api/procurement")))
        .status,
    ).toBe(401);
    expect(mocks.workspace).not.toHaveBeenCalled();
  });
  it("회사 마스터가 아닌 요청은 서버에서 거부한다", async () => {
    mocks.authorize.mockRejectedValue(new ProcurementError("권한 없음", 403));
    expect((await POST(request({ action: "collect" }))).status).toBe(403);
    expect(mocks.collect).not.toHaveBeenCalled();
  });
  it("다른 출처의 변경 요청을 차단한다", async () => {
    const r = new Request("https://www.owner-view.com/api/procurement", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
      body: "{}",
    });
    expect((await POST(r)).status).toBe(403);
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it("body의 다른 회사 지정으로 자료를 가져올 수 없다", async () => {
    await POST(request({ action: "collect", companyId: "foreign" }));
    expect(mocks.workspace).toHaveBeenCalledWith(
      expect.anything(),
      "trusted-company",
    );
  });
  it("다른 회사의 보관 파일을 증빙으로 연결할 수 없다", async () => {
    const e = fixtureWorkspace().evidence[0];
    expect(
      (
        await POST(
          request({
            action: "evidence",
            evidence: { ...e, documentFileId: "foreign-file" },
          }),
        )
      ).status,
    ).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("다른 회사의 공고나 오래된 차수로 평가할 수 없다", async () => {
    expect(
      (
        await POST(
          request({ action: "review", noticeId: "foreign-notice", review: {} }),
        )
      ).status,
    ).toBe(409);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("회사 자료가 변경되면 진행 결정을 차단한다", async () => {
    const w = fixtureWorkspace();
    w.reviews[0].evidence_hash = "stale";
    mocks.workspace.mockResolvedValue(w);
    expect(
      (
        await POST(
          request({
            action: "decision",
            noticeId: w.notices[0].id,
            reviewId: w.reviews[0].id,
            decision: "proceed",
            note: "진행",
          }),
        )
      ).status,
    ).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("본문·수신자 확인 없이 메일을 발송하지 않는다", async () => {
    expect((await POST(request({ action: "send-digest" }))).status).toBe(400);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("메일 미리보기는 발송을 실행하지 않는다", async () => {
    const r = await GET(
      new Request("https://www.owner-view.com/api/procurement?view=digest"),
    );
    expect(r.status).toBe(200);
    expect((await r.json()).html).toContain("오늘의 입찰 검토");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("저장소 준비 전에는 저장하지 않는다", async () => {
    mocks.workspace.mockResolvedValue({ ...fixtureWorkspace(), ready: false });
    expect((await POST(request({ action: "collect" }))).status).toBe(503);
    expect(mocks.collect).not.toHaveBeenCalled();
  });
});
