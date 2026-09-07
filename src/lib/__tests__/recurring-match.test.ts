// 통장 출금 ↔ 정기 지출 짝 맞추기 — 통장 개요 '자동이체 연결 내역' 이 이 규칙으로 채워진다 (2026-09-07).
import { describe, it, expect } from "vitest";
import { buildRecurringPatterns, matchRecurring, isAutoTransferTx } from "../recurring-match";

const RP = [
  { id: "r1", name: "사무실 임대료", recipient_name: "한빛빌딩", amount: 1_500_000, category: "rent", is_active: true },
  { id: "r2", name: "코웨이 정수기", amount: 39_900, category: "subscription", is_active: true },
  { id: "r3", name: "옛 보험", amount: 100_000, category: "insurance", is_active: false },
  { id: "r4", name: "AWS", amount: 0, category: "subscription", is_active: true },
];
const P = buildRecurringPatterns(RP);

describe("정기 지출 매칭", () => {
  it("거래처 이름이 겹치고 금액이 ±5% 안이면 그 정기 지출", () => {
    expect(matchRecurring({ type: "expense", counterparty: "한빛빌딩", amount: 1_500_000 }, P)?.id).toBe("r1");
    expect(matchRecurring({ type: "expense", counterparty: "(주)코웨이", amount: 40_000 }, P)?.id).toBe("r2");
  });
  it("금액이 많이 다르면 아니다", () => {
    expect(matchRecurring({ type: "expense", counterparty: "한빛빌딩", amount: 900_000 }, P)).toBeNull();
  });
  it("금액을 안 적어 둔 정기 지출은 이름만으로", () => {
    expect(matchRecurring({ type: "expense", counterparty: "AWS EMEA", amount: 123_456 }, P)?.id).toBe("r4");
  });
  it("꺼 둔 정기 지출·입금·이름 없음은 아니다", () => {
    expect(matchRecurring({ type: "expense", counterparty: "옛 보험", amount: 100_000 }, P)).toBeNull();
    expect(matchRecurring({ type: "income", counterparty: "한빛빌딩", amount: 1_500_000 }, P)).toBeNull();
    expect(matchRecurring({ type: "expense", counterparty: "", amount: 1_500_000 }, P)).toBeNull();
  });
  it("적요로도 맞춘다", () => {
    expect(matchRecurring({ type: "expense", counterparty: "자동이체", description: "코웨이 렌탈료", amount: 39_900 }, P)?.id).toBe("r2");
  });
  it("사람이 켠 표시는 정기 지출이 없어도 자동이체", () => {
    expect(isAutoTransferTx({ type: "expense", counterparty: "아무데나", amount: 5000, is_auto_transfer: true }, P)).toBe(true);
    expect(isAutoTransferTx({ type: "expense", counterparty: "아무데나", amount: 5000 }, P)).toBe(false);
  });
});
