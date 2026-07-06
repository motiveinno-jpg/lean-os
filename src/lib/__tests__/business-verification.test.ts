// 국세청 사업자번호 검증 — checksum 로컬 검증 + API 응답 상태 매핑(미등록/장애 구분).
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invokeMock(...args) } },
}));

import { verifyBusinessNumber } from "@/lib/business-verification";

describe("verifyBusinessNumber", () => {
  beforeEach(() => invokeMock.mockReset());

  it("자릿수 부족 → API 호출 없이 valid:false", async () => {
    const r = await verifyBusinessNumber("123-45");
    expect(r.valid).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("checksum 불일치 → API 호출 없이 valid:false", async () => {
    // 155-88-02209 의 마지막 자리를 틀리게 (정상 checksum=9)
    const r = await verifyBusinessNumber("155-88-02208");
    expect(r.valid).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("b_stt_cd 01 → 계속사업자", async () => {
    invokeMock.mockResolvedValue({ data: { results: [{ b_stt_cd: "01", tax_type: "부가가치세 일반과세자" }] }, error: null });
    const r = await verifyBusinessNumber("155-88-02209");
    expect(r).toMatchObject({ valid: true, status: "계속사업자" });
  });

  it("b_stt_cd 03 → 폐업자", async () => {
    invokeMock.mockResolvedValue({ data: { results: [{ b_stt_cd: "03" }] }, error: null });
    expect((await verifyBusinessNumber("155-88-02209")).status).toBe("폐업자");
  });

  it("API 정상 응답 + b_stt_cd 없음(국세청에 없는 번호) → 미등록 (장애와 구분)", async () => {
    invokeMock.mockResolvedValue({
      data: { results: [{ b_stt_cd: "", tax_type: "국세청에 등록되지 않은 사업자등록번호입니다." }] },
      error: null,
    });
    expect((await verifyBusinessNumber("155-88-02209")).status).toBe("미등록");
  });

  it("EF 호출 실패 → 확인불가 (fail-open 신호)", async () => {
    invokeMock.mockRejectedValueOnce(new Error("boom"));
    expect((await verifyBusinessNumber("155-88-02209")).status).toBe("확인불가");
  });
});
