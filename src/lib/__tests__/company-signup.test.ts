// 가입 크리티컬 경로 — 사업자번호 유틸 + 국세청 가입 게이트(assertBizNoActive) 판정표.
//   가입 차단/허용 규칙이 바뀌면 여기가 먼저 깨져야 한다.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/billing", () => ({ createTrialingSubscription: vi.fn() }));
vi.mock("@/lib/business-verification", () => ({ verifyBusinessNumber: vi.fn() }));

import { bizNoDigits, formatBizNo, isValidBizNo, assertBizNoActive } from "@/lib/company-signup";
import { verifyBusinessNumber } from "@/lib/business-verification";

const mockVerify = vi.mocked(verifyBusinessNumber);

describe("사업자번호 유틸", () => {
  it("bizNoDigits — 숫자만 추출, 10자리 초과 절단", () => {
    expect(bizNoDigits("155-88-02209")).toBe("1558802209");
    expect(bizNoDigits("155-88-02209999")).toBe("1558802209");
    expect(bizNoDigits("abc")).toBe("");
    expect(bizNoDigits("")).toBe("");
  });

  it("formatBizNo — 10자리만 하이픈 포맷", () => {
    expect(formatBizNo("1558802209")).toBe("155-88-02209");
    expect(formatBizNo("12345")).toBe("12345"); // 미완성 입력은 그대로
  });

  it("isValidBizNo — 10자리 여부", () => {
    expect(isValidBizNo("155-88-02209")).toBe(true);
    expect(isValidBizNo("155-88-0220")).toBe(false);
  });
});

describe("assertBizNoActive — 가입 게이트 판정표 (정상 사업자만 허용)", () => {
  beforeEach(() => mockVerify.mockReset());

  it("계속사업자 → 허용", async () => {
    mockVerify.mockResolvedValue({ valid: true, status: "계속사업자" });
    expect((await assertBizNoActive("155-88-02209")).ok).toBe(true);
  });

  it("미등록(국세청에 없는 번호) → 차단", async () => {
    mockVerify.mockResolvedValue({ valid: true, status: "미등록" });
    const r = await assertBizNoActive("155-88-02209");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("등록되지 않은");
  });

  it("폐업자 → 차단", async () => {
    mockVerify.mockResolvedValue({ valid: true, status: "폐업자" });
    const r = await assertBizNoActive("155-88-02209");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("폐업");
  });

  it("휴업자 → 차단", async () => {
    mockVerify.mockResolvedValue({ valid: true, status: "휴업자" });
    const r = await assertBizNoActive("155-88-02209");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("휴업");
  });

  it("checksum 불일치(valid:false) → 차단", async () => {
    mockVerify.mockResolvedValue({ valid: false, status: "확인불가" });
    const r = await assertBizNoActive("123-45-67890");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("유효하지 않은");
  });

  it("확인불가(국세청 API 장애) → 통과 (fail-open — 장애가 가입을 막으면 안 됨)", async () => {
    mockVerify.mockResolvedValue({ valid: true, status: "확인불가" });
    expect((await assertBizNoActive("155-88-02209")).ok).toBe(true);
  });

  it("조회 자체가 reject → 통과 (fail-open)", async () => {
    mockVerify.mockRejectedValueOnce(new Error("network"));
    expect((await assertBizNoActive("155-88-02209")).ok).toBe(true);
  });
});
