import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ getUser: vi.fn(), requirePerm: vi.fn(), from: vi.fn(), browser: vi.fn(), build: vi.fn(), sealFetch: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: m.getUser } }) }));
vi.mock("@/lib/supabase-admin", () => ({ createSupabaseAdminClient: () => ({ from: m.from }) }));
vi.mock("@/lib/api-authz", () => ({ requirePerm: m.requirePerm }));
vi.mock("@/lib/headless-chrome", () => ({ getPdfBrowser: m.browser }));
vi.mock("@/lib/contract-print-html", () => ({ buildSignedContractPrintHtml: m.build, STRIP_BODY_SIGNATURE_FN: "strip", PRETENDARD_CSS: "https://fonts.test/font.css" }));
vi.mock("@/lib/pdf-fetch-guard", () => ({ isAllowedAssetUrl: () => false, fetchAssetAsDataUrl: m.sealFetch }));
import { POST } from "./route";

let page: any;
let browser: any;
let row: any;
let queryError: any;
beforeEach(() => {
  vi.clearAllMocks(); queryError = null;
  m.getUser.mockResolvedValue({ data: { user: { id: "auth" } } });
  m.requirePerm.mockResolvedValue({ ok: true, caller: { companyId: "company" } });
  row = { id: "signed", signed_contract_html: "<p>서명 당시 본문</p>", template_snapshot_html: "원본", companies: {}, partner_id: null };
  m.from.mockImplementation((table) => {
    if (table !== "signature_requests") throw new Error(`unexpected table ${table}`);
    const query: any = {};
    for (const method of ["select", "in", "eq"]) query[method] = vi.fn(() => query);
    query.then = (resolve: any) => Promise.resolve({ data: [row], error: queryError }).then(resolve);
    return query;
  });
  page = {};
  for (const method of ["setDefaultNavigationTimeout", "setDefaultTimeout", "setRequestInterception", "on", "setContent", "addScriptTag", "close"]) page[method] = vi.fn().mockResolvedValue(undefined);
  page.evaluate = vi.fn().mockResolvedValue("<p>정제된 확정 본문</p>");
  page.pdf = vi.fn().mockResolvedValue(Buffer.from("pdf"));
  browser = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn().mockResolvedValue(undefined) };
  m.browser.mockResolvedValue(browser);
  m.build.mockReturnValue("<html>final</html>");
});
const request = () => new NextRequest("http://localhost/api/contract-pdf", { method: "POST", body: JSON.stringify({ ids: ["signed"] }) });
describe("계약 PDF 기능 회귀", () => {
  it("현재 회사 양식을 조회하지 않고 확정 본문을 렌더하며 자기 페이지만 닫는다", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).results[0].pdfBase64).toBe(Buffer.from("pdf").toString("base64"));
    expect(m.requirePerm).toHaveBeenCalledWith(expect.anything(), "auth", "/signatures");
    expect(page.evaluate.mock.calls[0][1]).toBe("<p>서명 당시 본문</p>");
    expect(page.close).toHaveBeenCalledOnce();
    expect(browser.close).not.toHaveBeenCalled();
  });
  it("PDF 실패해도 자기 페이지는 닫고 다른 요청의 공용 브라우저는 유지한다", async () => {
    page.pdf.mockRejectedValue(new Error("render failed"));
    const body = await (await POST(request())).json();
    expect(body.results[0].error).toBe("render failed");
    expect(page.close).toHaveBeenCalledOnce(); expect(browser.close).not.toHaveBeenCalled();
  });
  it("새 페이지 생성 실패가 다른 요청의 브라우저까지 닫지는 않는다", async () => {
    browser.newPage.mockRejectedValue(new Error("no page"));
    expect((await POST(request())).status).toBe(500);
    expect(browser.close).not.toHaveBeenCalled();
  });
  it("본문이 없으면 현재 양식이나 빈 문서를 대신 출력하지 않는다", async () => {
    row.signed_contract_html = null; row.template_snapshot_html = null;
    const body = await (await POST(request())).json();
    expect(body.results[0].error).toContain("계약 본문"); expect(m.browser).not.toHaveBeenCalled();
  });
  it("조회 실패를 빈 성공 목록으로 바꾸지 않는다", async () => {
    queryError = { message: "DB down" };
    expect((await POST(request())).status).toBe(500);
  });
  it("권한이 없으면 렌더러를 실행하지 않는다", async () => {
    m.requirePerm.mockResolvedValue({ ok: false, status: 403, error: "denied" });
    expect((await POST(request())).status).toBe(403); expect(m.browser).not.toHaveBeenCalled();
  });
});
