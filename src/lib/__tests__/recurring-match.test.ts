// 통장 출금 ↔ 정기 지출 짝 맞추기 — 통장 개요 '자동이체 연결 내역' 이 이 규칙으로 채워진다 (2026-09-07).
import { describe, it, expect } from "vitest";
import { buildRecurringPatterns, matchRecurring, isAutoTransferTx, dueDateInMonth, reconcileRecurringMonth } from "../recurring-match";

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

describe("한 달 대조 — 정기 지출 3건이 나감/예정/확인 필요로 전부 보인다", () => {
  const RP2 = [
    { id: "kt", name: "(주)케이티 (공과금)", recipient_name: "(주)케이티", amount: 42900, day_of_month: 25, is_active: true },
    { id: "rent", name: "안형영 (기타)", recipient_name: "안형영", amount: 1595000, day_of_month: 2, is_active: true },
    { id: "tax", name: "홍순구（드림세무회계", recipient_name: "홍순구（드림세무회계", amount: 220000, day_of_month: 31, is_active: true },
  ];
  const TX = [{ id: "t1", type: "expense", counterparty: "안형영", amount: -1595000, transaction_date: "2026-09-02" }];
  it("31일은 9월엔 30일로, next_due_date 는 그 달 것만", () => {
    expect(dueDateInMonth(RP2[2], "2026-09")).toBe("2026-09-30");
    expect(dueDateInMonth({ day_of_month: 25, next_due_date: "2026-08-25" }, "2026-09")).toBe("2026-09-25");
    expect(dueDateInMonth({ day_of_month: 25, next_due_date: "2026-09-12" }, "2026-09")).toBe("2026-09-12");
  });
  it("9/7 기준: 안형영 나감, 케이티·홍순구 예정 — 3건 다 나온다", () => {
    const { rows, manualOnly } = reconcileRecurringMonth(RP2, TX, "2026-09", "2026-09-07");
    expect(rows.map((r) => `${r.rp.id}:${r.state}`)).toEqual(["rent:paid", "kt:due", "tax:due"]);
    expect(rows[0].tx?.id).toBe("t1"); expect(manualOnly).toEqual([]);
  });
  it("9/26 기준: 케이티 25일이 지났는데 출금이 없으면 확인 필요", () => {
    const { rows } = reconcileRecurringMonth(RP2, TX, "2026-09", "2026-09-26");
    expect(rows.map((r) => `${r.rp.id}:${r.state}`)).toEqual(["rent:paid", "kt:missing", "tax:due"]);
  });
  it("정기 지출과 안 맞지만 직접 표시한 출금은 따로", () => {
    const { manualOnly } = reconcileRecurringMonth(RP2, [{ id: "m", type: "expense", counterparty: "아무개", amount: -1000, is_auto_transfer: true, transaction_date: "2026-09-03" }], "2026-09", "2026-09-07");
    expect(manualOnly.map((t) => t.id)).toEqual(["m"]);
  });
});
