import { describe, expect, it } from "vitest";
import { approvalDraftDate } from "@/lib/approval-pdf";

describe("approvalDraftDate", () => {
  it("양식에 입력한 기안일을 반환한다", () => {
    expect(approvalDraftDate([
      { label: "부서 - 이름", value: "경영지원 - 홍길동" },
      { label: "기안일", value: "2026-08-29" },
    ])).toBe("2026-08-29");
  });

  it("라벨의 공백과 콜론 표기도 기안일로 인식한다", () => {
    expect(approvalDraftDate([{ label: "기안 일 :", value: "2026-09-01" }])).toBe("2026-09-01");
  });

  it("기안일이 없거나 비어 있으면 null을 반환한다", () => {
    expect(approvalDraftDate([{ label: "결제요청일", value: "2026-09-07" }])).toBeNull();
    expect(approvalDraftDate([{ label: "기안일", value: "-" }])).toBeNull();
  });
});
