import { describe, it, expect } from "vitest";
import { friendlyError } from "@/lib/friendly-error";
import { StorageQuotaError, storageFullMessage } from "@/lib/storage-quota";

// 2026-09-02 QA시드 실측 — 저장공간 한도 안내가 사용자에게 그대로 닿는지.
describe("friendlyError × 저장공간 한도", () => {
  it("사전검사 에러(code=STORAGE_QUOTA)는 80자를 넘어도 문구 그대로", () => {
    const msg = storageFullMessage({ usedBytes: 54210330624, quotaBytes: 54211379200 }, 2 * 1024 * 1024);
    expect(msg.length).toBeGreaterThan(40);
    expect(friendlyError(new StorageQuotaError(msg), "알 수 없는 오류")).toBe(msg);
    expect(msg).toContain("남은 공간 1 MB");
  });
  it("Supabase Storage RLS 거절 실물 형태 → 저장공간/권한 안내", () => {
    const raw = { statusCode: "403", error: "Unauthorized", code: "AccessDenied", message: "new row violates row-level security policy" };
    const out = friendlyError(raw, "알 수 없는 오류");
    expect(out).toContain("저장공간");
    expect(out).not.toBe("알 수 없는 오류");
  });
  it("일반 RLS 기술 메시지는 여전히 폴백", () => {
    expect(friendlyError(new Error("new row violates check constraint"), "폴백")).toBe("폴백");
  });
});
