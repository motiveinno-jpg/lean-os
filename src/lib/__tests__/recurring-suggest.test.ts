// 반복 결제 후보 — 통장·카드 개요의 "정기 지출로 등록할까요?" 추천 규칙 (2026-09-07 사장님 요청).
import { describe, it, expect } from "vitest";
import { detectRecurringCandidates } from "../recurring-suggest";
import { cardTxToLite } from "../recurring-match";

const bank = (id: string, date: string, cp: string, amount: number, extra: object = {}) =>
  ({ id, type: "expense", transaction_date: date, counterparty: cp, amount: -amount, source: "bank" as const, ...extra });

describe("detectRecurringCandidates", () => {
  it("매달 비슷한 날 비슷한 금액이면 후보 — 금액 중앙값·날짜 중앙값·횟수", () => {
    const txs = [bank("1", "2026-06-25", "(주)케이티", 42900), bank("2", "2026-07-25", "(주)케이티", 43100), bank("3", "2026-08-25", "(주)케이티", 42900)];
    const c = detectRecurringCandidates(txs, [], { todayStr: "2026-09-07" });
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ source: "bank", counterparty: "(주)케이티", amount: 42900, dayOfMonth: 25, count: 3, lastDate: "2026-08-25" });
    expect(c[0].txIds).toEqual(["1", "2", "3"]);
  });
  it("이미 정기 지출로 등록된 거래처는 추천하지 않는다", () => {
    const txs = [bank("1", "2026-07-25", "(주)케이티", 42900), bank("2", "2026-08-25", "(주)케이티", 42900)];
    expect(detectRecurringCandidates(txs, [{ name: "(주)케이티", amount: 42900, is_active: true }])).toEqual([]);
  });
  it("사람이 이미 표시한 줄은 뺀다", () => {
    const txs = [bank("1", "2026-07-25", "코웨이", 45900, { is_auto_transfer: true }), bank("2", "2026-08-25", "코웨이", 45900, { is_auto_transfer: true })];
    expect(detectRecurringCandidates(txs, [])).toEqual([]);
  });
  it("같은 달 안에서만 여러 번(편의점·주유)은 후보가 아니다", () => {
    const txs = [bank("1", "2026-08-03", "GS25", 5200), bank("2", "2026-08-10", "GS25", 5100), bank("3", "2026-08-17", "GS25", 5300)];
    expect(detectRecurringCandidates(txs, [])).toEqual([]);
  });
  it("금액이 널뛰면 후보가 아니다", () => {
    const txs = [bank("1", "2026-07-25", "쿠팡", 12000), bank("2", "2026-08-25", "쿠팡", 98000)];
    expect(detectRecurringCandidates(txs, [])).toEqual([]);
  });
  it("카드 결제도 같은 규칙 — source 가 card 로 구분된다", () => {
    const txs = [
      cardTxToLite({ id: "c1", transaction_date: "2026-07-06", amount: 11100, merchant_name: "Apple", card_name: "롯데카드" }),
      cardTxToLite({ id: "c2", transaction_date: "2026-08-06", amount: 11100, merchant_name: "Apple", card_name: "롯데카드" }),
    ];
    const c = detectRecurringCandidates(txs, [], { todayStr: "2026-09-07" });
    expect(c[0]).toMatchObject({ source: "card", counterparty: "Apple", amount: 11100, dayOfMonth: 6, count: 2 });
  });
  it("입금·소액·거래처 없음은 뺀다", () => {
    const txs = [bank("1", "2026-07-25", "누군가", 500), bank("2", "2026-08-25", "누군가", 500), { ...bank("3", "2026-07-01", "정우", 1000000), type: "income" }, bank("4", "2026-07-01", "", 50000)];
    expect(detectRecurringCandidates(txs, [])).toEqual([]);
  });
});

describe("급여·끊긴 패턴은 권하지 않는다", () => {
  it("직원 이름과 같은 거래처(급여 이체)는 뺀다", () => {
    const txs = [bank("1", "2026-07-31", "채희웅", 8277044), bank("2", "2026-08-31", "채희웅", 8277044)];
    expect(detectRecurringCandidates(txs, [], { excludeNames: ["채희웅", "연준호"], todayStr: "2026-09-07" })).toEqual([]);
    expect(detectRecurringCandidates(txs, [], { todayStr: "2026-09-07" })).toHaveLength(1);
  });
  it("마지막 결제가 45일 넘게 지난 패턴은 뺀다", () => {
    const txs = [bank("1", "2026-04-13", "국민건강보험공단", 1514245), bank("2", "2026-05-11", "국민건강보험공단", 1514245)];
    expect(detectRecurringCandidates(txs, [], { todayStr: "2026-09-07" })).toEqual([]);
    expect(detectRecurringCandidates(txs, [], { todayStr: "2026-06-01" })).toHaveLength(1);
  });
});
