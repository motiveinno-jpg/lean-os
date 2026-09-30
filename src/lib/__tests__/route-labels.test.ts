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

  //   사이드바에 ?tab= 으로 편 메뉴는 머리 제목도 그 메뉴 이름 (2026-09-30)
  it("탭 메뉴는 탭 제목, 모르는 탭·탭 없음은 기본 제목", () => {
    expect(getRouteCrumb("/employees/", "salary")?.title).toBe("급여");
    expect(getRouteCrumb("/employees/")?.title).toBe("구성원");
    expect(getRouteCrumb("/inventory/channels/", "settle")?.title).toBe("정산");
    expect(getRouteCrumb("/inventory/channels/", "history")?.title).toBe("주문 가져오기");
    expect(getRouteCrumb("/inventory/channels/", "status")?.title).toBe("현황");
    expect(getRouteCrumb("/inventory/channels/", "zzz")?.group).toBe("이커머스");
  });

  it("미등록 경로 → null", () => {
    expect(getRouteCrumb("/nonexistent")).toBeNull();
  });
});
