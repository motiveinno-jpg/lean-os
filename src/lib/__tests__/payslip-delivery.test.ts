import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ from: vi.fn(), session: vi.fn(), pdf: vi.fn(), preview: vi.fn(), fetch: vi.fn(), upsert: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: m.from, auth: { getSession: m.session } } }));
vi.mock("@/lib/payslip-pdf", () => ({ generatePayslipPDF: m.pdf, birthDateToPassword: () => "19900101" }));
vi.mock("@/lib/payroll", () => ({ previewPayroll: m.preview }));
vi.mock("@/lib/signatures", () => ({ resolveSealUrl: async () => null }));
import { sendPayslipEmails } from "@/lib/payment-batch";
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", m.fetch);
  m.session.mockResolvedValue({ data: { session: { access_token: "test" } } });
  m.pdf.mockResolvedValue({ output: () => "data:application/pdf;base64,cGRm" });
  m.preview.mockResolvedValue({ items: [{ employeeId: "emp", employeeName: "직원", extras: [] }] });
  m.upsert.mockResolvedValue({ error: null });
  m.from.mockImplementation((table) => {
    const query: any = {};
    for (const method of ["select", "eq", "in"]) query[method] = vi.fn(() => query);
    query.single = vi.fn().mockResolvedValue({ data: { name: "회사" }, error: null });
    query.then = (resolve: any) => Promise.resolve({ data: [{ id: "emp", email: "employee@example.test" }], error: null }).then(resolve);
    query.upsert = m.upsert;
    return query;
  });
});
describe("급여메일 성공/실패 분리", () => {
  it("PDF 생성 실패도 실패 건수에 들어간다", async () => {
    m.pdf.mockRejectedValue(new Error("PDF error"));
    expect(await sendPayslipEmails("preview", "company", "2026년 9월")).toMatchObject({ sent: 0, failed: 1 });
    expect(m.fetch).not.toHaveBeenCalled(); expect(m.upsert).not.toHaveBeenCalled();
  });
  it.each([{ success: true, fallback: true }, { success: false }, {}])("HTTP 200만으로 발송 성공 처리하지 않는다: %j", async (body) => {
    m.fetch.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    expect(await sendPayslipEmails("preview", "company", "2026년 9월")).toMatchObject({ sent: 0, failed: 1 });
    expect(m.upsert).not.toHaveBeenCalled();
  });
  it("실제 발송 성공이면 해당 월 발급 기록을 저장한다", async () => {
    m.fetch.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    expect(await sendPayslipEmails("preview", "company", "2026-09 급여")).toMatchObject({ sent: 1, failed: 0 });
    expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ period_month: "2026-09", status: "issued" }), expect.anything());
  });
  it("로그인 만료를 0건 성공으로 숨기지 않는다", async () => {
    m.session.mockResolvedValue({ data: { session: null } });
    await expect(sendPayslipEmails("preview", "company", "2026년 9월")).rejects.toThrow("다시 로그인");
  });
});
