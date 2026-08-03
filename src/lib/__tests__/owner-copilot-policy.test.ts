import { describe, expect, it } from "vitest";
import {
  isAttachmentContractDraftRequest,
  OWNER_COPILOT_MAX_CALL_TIMEOUT_MS,
  OWNER_COPILOT_REQUEST_BUDGET_MS,
  remainingOwnerCopilotCallTimeout,
} from "../../../supabase/functions/_shared/owner-copilot-policy";
import { explainError } from "@/lib/operator-error-explain";

describe("owner-copilot request policy", () => {
  it("계약서 파일과 생성 의도가 함께 있으면 단일 계약서 초안 경로를 선택한다", () => {
    expect(isAttachmentContractDraftRequest(
      "이 내용에 맞게 전자계약 양식으로 만들어줘",
      ["26년 온라인홍보 개별계약서.hwp"],
      "manager",
    )).toBe(true);
  });

  it("계약서 파일이어도 요약 요청이나 직원 요청은 계약 생성으로 오인하지 않는다", () => {
    expect(isAttachmentContractDraftRequest(
      "핵심 내용만 요약해줘",
      ["용역계약서.hwpx"],
      "manager",
    )).toBe(false);
    expect(isAttachmentContractDraftRequest(
      "계약서 초안 만들어줘",
      ["용역계약서.hwpx"],
      "employee",
    )).toBe(false);
  });

  it("개별 AI 호출과 전체 작업 예산이 Edge 150초 제한보다 짧다", () => {
    expect(OWNER_COPILOT_MAX_CALL_TIMEOUT_MS).toBeLessThan(OWNER_COPILOT_REQUEST_BUDGET_MS);
    expect(OWNER_COPILOT_REQUEST_BUDGET_MS).toBeLessThan(150_000);
    expect(remainingOwnerCopilotCallTimeout(1_000, 1_000)).toBe(OWNER_COPILOT_MAX_CALL_TIMEOUT_MS);
    expect(remainingOwnerCopilotCallTimeout(1_000, 115_000)).toBe(6_000);
    expect(remainingOwnerCopilotCallTimeout(1_000, 120_000)).toBe(0);
  });

  it("Supabase Edge idle timeout 원문을 HTTP_504로 분류한다", () => {
    const result = explainError(
      "[DB 504] POST /functions/v1/owner-copilot — Request idle timeout limit (150s)",
    );
    expect(result.code).toBe("js:HTTP_504");
    expect(result.severity).toBe("high");
  });
});
