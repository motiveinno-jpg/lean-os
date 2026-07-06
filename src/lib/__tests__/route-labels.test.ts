// 헤더바 브레드크럼 라우트 매핑 — 최장 prefix 우선 규칙 회귀 방지.
import { describe, it, expect } from "vitest";
import { getRouteCrumb } from "@/lib/route-labels";

describe("getRouteCrumb — 최장 prefix 우선", () => {
  it("하위 경로가 상위보다 우선", () => {
    expect(getRouteCrumb("/partners")?.title).toBe("거래처 관리");
    expect(getRouteCrumb("/partners/ledger")?.title).toBe("거래처 원장");
    expect(getRouteCrumb("/partners/reconciliation")?.title).toBe("거래 매칭");
    expect(getRouteCrumb("/partners/reconciliation/voucher-entry")?.title).toBe("전표입력");
  });

  it("동적 세그먼트도 prefix 매칭", () => {
    expect(getRouteCrumb("/projecthub/abc-123")?.title).toBe("프로젝트");
    expect(getRouteCrumb("/reports/pnl")?.title).toBe("손익계산서");
  });

  it("미등록 경로 → null", () => {
    expect(getRouteCrumb("/nonexistent")).toBeNull();
  });
});
