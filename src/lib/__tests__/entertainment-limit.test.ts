// 기업업무추진비 한도 — 법인세법 제25조 ④ 구간 대조 (2026-10-07 ERP 3차 C)
import { describe, it, expect } from "vitest";
import { entertainmentLimit, revenueLimit, isEntertainmentAccount, isSalesAccount } from "@/lib/entertainment-limit";

describe("수입금액 한도", () => {
  it("10억 = 300만", () => expect(revenueLimit(1_000_000_000)).toBe(3_000_000));
  it("100억 경계 = 3,000만", () => expect(revenueLimit(10_000_000_000)).toBe(30_000_000));
  it("200억 = 3,000만 + 100억×0.2% = 5,000만", () => expect(revenueLimit(20_000_000_000)).toBe(50_000_000));
  it("500억 경계 = 1억 1,000만", () => expect(revenueLimit(50_000_000_000)).toBe(110_000_000));
  it("600억 = 1억 1,000만 + 100억×0.03% = 1억 1,300만", () => expect(revenueLimit(60_000_000_000)).toBe(113_000_000));
  it("음수 매출은 0", () => expect(revenueLimit(-5)).toBe(0));
});

describe("한도·초과", () => {
  it("중소기업 매출 10억 · 지출 5,000만 → 한도 3,900만 · 초과 1,100만", () => {
    const r = entertainmentLimit(50_000_000, 1_000_000_000, true);
    expect(r.limit).toBe(39_000_000);
    expect(r.excess).toBe(11_000_000);
  });
  it("일반기업은 기본 1,200만", () => expect(entertainmentLimit(0, 0, false).base).toBe(12_000_000));
  it("한도 안이면 초과 0", () => expect(entertainmentLimit(10_000_000, 1_000_000_000, true).excess).toBe(0));
  it("사업연도 6개월이면 기본한도 절반", () => expect(entertainmentLimit(0, 0, true, 6).base).toBe(18_000_000));
});

describe("계정 판별", () => {
  it("표준 코드·이름", () => {
    expect(isEntertainmentAccount("813", "접대비(기업업무추진비)")).toBe(true);
    expect(isEntertainmentAccount("999", "거래처 업무추진비")).toBe(true);
    expect(isEntertainmentAccount("811", "복리후생비")).toBe(false);
  });
  it("매출 401~450", () => {
    expect(isSalesAccount("401")).toBe(true);
    expect(isSalesAccount("403")).toBe(true);
    expect(isSalesAccount("901")).toBe(false);
    expect(isSalesAccount(null)).toBe(false);
  });
});
