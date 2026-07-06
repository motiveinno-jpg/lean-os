// 가입 크리티컬 경로 — 사업자번호 유틸 + 국세청 가입 게이트(assertBizNoActive) 판정표.
//   가입 차단/허용 규칙이 바뀌면 여기가 먼저 깨져야 한다.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/billing", () => ({ createTrialingSubscription: vi.fn() }));
vi.mock("@/lib/business-verification", () => ({ verifyBusinessNumber: vi.fn(), validateBusinessOwnership: vi.fn() }));

import { bizNoDigits, formatBizNo, isValidBizNo, assertBizNoActive, assertBizNoOwnerValid } from "@/lib/company-signup";
import { verifyBusinessNumber, validateBusinessOwnership } from "@/lib/business-verification";

const mockVerify = vi.mocked(verifyBusinessNumber);
const mockOwner = vi.mocked(validateBusinessOwnership);

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

describe("assertBizNoOwnerValid — 대표자 진위확인 게이트 (선점 방지)", () => {
  beforeEach(() => { mockOwner.mockReset(); mockVerify.mockReset(); });

  it("진위 일치 + 계속사업자 → 허용", async () => {
    mockOwner.mockResolvedValue({ result: "match", status: "계속사업자" });
    expect((await assertBizNoOwnerValid("155-88-02209", "채희웅", "2021-01-01")).ok).toBe(true);
  });

  it("대표자·개업일 불일치 → 차단 (선점 시도)", async () => {
    mockOwner.mockResolvedValue({ result: "mismatch" });
    const r = await assertBizNoOwnerValid("155-88-02209", "사칭자", "2020-01-01");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("일치하지 않습니다");
  });

  it("진위 일치라도 폐업자 → 차단", async () => {
    mockOwner.mockResolvedValue({ result: "match", status: "폐업자" });
    expect((await assertBizNoOwnerValid("155-88-02209", "채희웅", "2021-01-01")).ok).toBe(false);
  });

  it("대표자명 미입력 → 차단 (API 호출 전)", async () => {
    const r = await assertBizNoOwnerValid("155-88-02209", "  ", "2021-01-01");
    expect(r.ok).toBe(false);
    expect(mockOwner).not.toHaveBeenCalled();
  });

  it("개업일자 형식 불량 → 차단 (API 호출 전)", async () => {
    expect((await assertBizNoOwnerValid("155-88-02209", "채희웅", "2021-1")).ok).toBe(false);
    expect(mockOwner).not.toHaveBeenCalled();
  });

  it("진위 API 장애(unavailable) → 상태 조회 폴백 (계속사업자면 통과)", async () => {
    mockOwner.mockResolvedValue({ result: "unavailable" });
    mockVerify.mockResolvedValue({ valid: true, status: "계속사업자" });
    expect((await assertBizNoOwnerValid("155-88-02209", "채희웅", "2021-01-01")).ok).toBe(true);
    expect(mockVerify).toHaveBeenCalled(); // 폴백 경로 사용 확인
  });

  it("진위 API 장애 + 폴백에서 폐업 → 차단 (이중 게이트)", async () => {
    mockOwner.mockResolvedValue({ result: "unavailable" });
    mockVerify.mockResolvedValue({ valid: true, status: "폐업자" });
    expect((await assertBizNoOwnerValid("155-88-02209", "채희웅", "2021-01-01")).ok).toBe(false);
  });
});
