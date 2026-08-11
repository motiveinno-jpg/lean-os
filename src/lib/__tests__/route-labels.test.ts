// 헤더바 브레드크럼 라우트 매핑 — 최장 prefix 우선 규칙 회귀 방지.
import { describe, it, expect } from "vitest";
import { getRouteCrumb } from "@/lib/route-labels";

describe("getRouteCrumb — 최장 prefix 우선", () => {
  // 라벨은 4d0a9cd·e8c68c2 네비 개편(수집·전표 신설, 분석 그룹화) 이후의 현행 표기 기준.
  it("하위 경로가 상위보다 우선", () => {
    expect(getRouteCrumb("/partners")?.title).toBe("거래처");
    expect(getRouteCrumb("/partners/ledger")?.title).toBe("거래처 원장");
    expect(getRouteCrumb("/partners/reconciliation")?.title).toBe("거래 장부");
    expect(getRouteCrumb("/partners/reconciliation/voucher-entry")?.title).toBe("일반전표");
  });

  it("동적 세그먼트도 prefix 매칭", () => {
    expect(getRouteCrumb("/projecthub/abc-123")?.title).toBe("프로젝트");
    expect(getRouteCrumb("/reports/pnl")?.title).toBe("회계 자료");
  });

  it("미등록 경로 → null", () => {
    expect(getRouteCrumb("/nonexistent")).toBeNull();
  });
});
