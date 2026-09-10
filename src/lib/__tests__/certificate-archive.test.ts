import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), storageFrom: vi.fn(), upload: vi.fn(), insert: vi.fn(), logAudit: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from, storage: { from: mocks.storageFrom } } }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.logAudit }));
import { saveCertificateLog } from "@/lib/certificates";

const params = { companyId: "company-a", employeeId: "employee", certificateType: "재직증명서", certificateNumber: "CERT-1", issuedBy: "auth-user", pdf: new Blob(["pdf"]) };
beforeEach(() => {
  vi.clearAllMocks();
  const query: any = {};
  for (const method of ["select", "or", "limit"]) query[method] = vi.fn(() => query);
  query.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "app-user" }, error: null });
  mocks.from.mockImplementation((table) => table === "users" ? query : { insert: mocks.insert });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.storageFrom.mockReturnValue({ upload: mocks.upload, getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.test/storage/v1/object/public/documents/${path}` } }) });
});
describe("증명서 원본 보관", () => {
  it("회사 ID를 두 번째 폴더에 저장하고 새 원본 경로를 이력에 남긴다", async () => {
    await saveCertificateLog(params);
    const path = mocks.upload.mock.calls[0][0];
    expect(path).toMatch(/^certificates\/company-a\/[\w-]+\.pdf$/);
    expect(mocks.upload.mock.calls[0][2].upsert).toBe(false);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ issued_by: "app-user", pdf_url: expect.stringContaining(path) }));
  });
  it("업로드 실패를 발급 성공으로 기록하지 않는다", async () => {
    mocks.upload.mockResolvedValue({ error: { message: "RLS denied" } });
    await expect(saveCertificateLog(params)).rejects.toThrow("PDF 보관 실패");
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("동일 번호 재발급도 기존 원본을 덮어쓰지 않는다", async () => {
    await saveCertificateLog(params);
    await saveCertificateLog(params);
    expect(mocks.upload.mock.calls[0][0]).not.toBe(mocks.upload.mock.calls[1][0]);
  });
});
