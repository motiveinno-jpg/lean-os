import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// 실제 Edge 핸들러를 실행하되 외부 SDK/메일/결제 호출만 대체한다. 운영 환경변수 접근 없음.
function loadEdge(name: string, overrides: Record<string, unknown> = {}, env: Record<string, string> = {}) {
  let handler!: (req: Request) => Promise<Response>;
  const source = readFileSync(resolve(`supabase/functions/${name}/index.ts`), "utf8").replace(/^import .*;\r?$/gm, "");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const serve = (fn: typeof handler) => { handler = fn; };
  runInNewContext(code, { Request, Response, URL, Date, Set, JSON, console: { error: vi.fn() }, btoa,
    Deno: { env: { get: (key: string) => env[key] }, serve }, serve,
    withSentry: (_: string, fn: typeof handler) => fn,
    escapeHtml: (value: unknown) => String(value ?? ""),
    ...overrides,
  });
  return handler;
}
const request = (body: unknown) => new Request("https://local.test/edge", { method: "POST", headers: { Authorization: "Bearer fixture" }, body: JSON.stringify(body) });

describe("급여메일 Edge 실패 응답", () => {
  function setup(env: Record<string, string> = {}, allowed = true) {
    const send = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const rpc = vi.fn().mockResolvedValue({ data: allowed, error: null });
    const handler = loadEdge("send-payslip-email", {
      createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "user" } } }) }, rpc }),
      resolveCaller: async () => ({ companyId: "company", role: "employee", isMaster: false }),
      recipientInCompany: async () => true,
      deny: (error: string, status: number) => Response.json({ error }, { status }),
      tfetch: send, resolvePhone: async () => null, sendAlimtalk: vi.fn(),
    }, env);
    return { handler, send, rpc };
  }
  it("발송 설정 누락은 503이며 success:true가 아니다", async () => {
    const { handler, send } = setup();
    const response = await handler(request({ email: "a@example.test" }));
    expect(response.status).toBe(503); expect((await response.json()).success).not.toBe(true); expect(send).not.toHaveBeenCalled();
  });
  it("PDF 없이 메일만 보내지 않는다", async () => {
    const { handler, send } = setup({ RESEND_API_KEY: "test" });
    expect((await handler(request({ email: "a@example.test" }))).status).toBe(400); expect(send).not.toHaveBeenCalled();
  });
  it("위임된 급여 권한자는 정상 발송하고 무권한자는 차단한다", async () => {
    const { handler, send, rpc } = setup({ RESEND_API_KEY: "test" });
    expect((await handler(request({ email: "a@example.test", pdfBase64: "cGRm", pdfFilename: "test.pdf" }))).status).toBe(200);
    expect(send).toHaveBeenCalledOnce(); expect(rpc).toHaveBeenCalledWith("has_perm", { p_key: "/employees:salary" });
    const denied = setup({ RESEND_API_KEY: "test" }, false);
    expect((await denied.handler(request({ email: "a@example.test" }))).status).toBe(403); expect(denied.send).not.toHaveBeenCalled();
  });
});

describe("토스 웹훅 재전송·검증", () => {
  function setup({ lookupOk = true, invoiceError = null as unknown, invoice = { id: "invoice" } as unknown, applyError = null as unknown } = {}) {
    const query: any = {};
    for (const method of ["select", "eq"]) query[method] = vi.fn(() => query);
    query.maybeSingle = vi.fn().mockResolvedValue({ data: invoice, error: invoiceError });
    const rpc = vi.fn().mockResolvedValue({ data: { handled: true, duplicate: false }, error: applyError });
    const lookup = vi.fn().mockResolvedValue(Response.json({ paymentKey: "key", orderId: "verified-order", status: "CANCELED" }, { status: lookupOk ? 200 : 503 }));
    const handler = loadEdge("toss-webhook", { createClient: () => ({ from: () => query, rpc }), tfetch: lookup }, { TOSS_SECRET_KEY: "test" });
    return { handler, rpc, lookup };
  }
  it.each([{ lookupOk: false }, { invoiceError: { message: "db" } }, { invoice: null }, { applyError: { message: "db" } }])("실패 시 200을 보내 재전송을 막지 않는다: %j", async (options) => {
    const { handler } = setup(options);
    expect((await handler(request({ paymentKey: "key" }))).status).toBeGreaterThanOrEqual(500);
  });
  it("본문의 orderId를 신뢰하지 않고 검증된 결제값만 원자적 RPC에 전달한다", async () => {
    const { handler, rpc } = setup();
    expect((await handler(request({ paymentKey: "key", orderId: "forged-order" }))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("apply_toss_payment_void", { p_order_id: "verified-order", p_payment_key: "key", p_status: "CANCELED" });
  });
});
