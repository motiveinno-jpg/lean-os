import { describe, it, expect } from "vitest";
import { unitCostFromLayers, mergeUnitCost, costOfMove, nextOutUnitCost } from "../inventory-costing-calc";
import { partnerNameFromNote } from "../inventory";

//   재고 › 현황 마진과 이익관리 매출총이익이 같은 원가를 쓰는지, 재고금액이 한 단가로 모이는지 고정한다.

describe("재고 단가 — 남은 입고 층 기준", () => {
  it("선입선출로 앞 층이 다 나가면 남은 층 단가만 남는다", () => {
    const m = unitCostFromLayers([
      { product_id: "p", move_id: "a", qty_left: 0, unit_cost: 40000 },
      { product_id: "p", move_id: "b", qty_left: 10, unit_cost: 50000 },
      { product_id: "p", move_id: "c", qty_left: 10, unit_cost: 52000 },
    ]);
    expect(m.get("p")).toBe(51000);
  });
  it("단가 없는 층은 빼고, 층이 없으면 대체 단가를 쓴다", () => {
    const fromLayers = unitCostFromLayers([{ product_id: "p", move_id: "a", qty_left: 5, unit_cost: null }]);
    expect(fromLayers.has("p")).toBe(false);
    const merged = mergeUnitCost(unitCostFromLayers([{ product_id: "q", move_id: "b", qty_left: 2, unit_cost: 100 }]), new Map([["p", 70], ["q", 90]]));
    expect(merged.get("p")).toBe(70);
    expect(merged.get("q")).toBe(100);
  });
});

describe("줄 원가 — 출고 원가 한 함수", () => {
  const costs = new Map([["out1", { move_id: "out1", cost_amount: 441000, qty_uncosted: 0 }]]);
  const layers = new Map([["ret1", { product_id: "p", move_id: "ret1", qty_left: 1, unit_cost: 49000 }]]);
  it("판매 출고는 확정 출고 원가 그대로", () => {
    expect(costOfMove({ id: "out1", qty: -9 }, costs, layers)).toEqual({ cost: 441000, unc: 0 });
  });
  it("반품 입고는 그 층 단가만큼 원가를 뺀다", () => {
    expect(costOfMove({ id: "ret1", qty: 1 }, costs, layers)).toEqual({ cost: -49000, unc: 0 });
  });
  it("원가가 안 정해진 출고는 0원이 아니라 미확정 수량", () => {
    expect(costOfMove({ id: "x", qty: -3 }, costs, layers)).toEqual({ cost: 0, unc: 3 });
  });
});

describe("이력 거래처 칸 — 이름만 친 거래처", () => {
  it("메모의 '거래처: 이름'을 읽는다", () => {
    expect(partnerNameFromNote("거래처: 한빛상사")).toBe("한빛상사");
    expect(partnerNameFromNote("급송 · 거래처: 한빛상사")).toBe("한빛상사");
    expect(partnerNameFromNote("거래처: 한빛상사 · 메모")).toBe("한빛상사");
  });
  it("거래처 표시가 없으면 null — 창고·메모로 채우지 않는다", () => {
    expect(partnerNameFromNote("본사창고")).toBeNull();
    expect(partnerNameFromNote(null)).toBeNull();
  });
});

describe("다음 출고 단가 — 이익 › 품목별", () => {
  const layers = [
    { product_id: "p", move_id: "a", qty_left: 0, unit_cost: 40000 },
    { product_id: "p", move_id: "b", qty_left: 3, unit_cost: 50000 },
    { product_id: "p", move_id: "c", qty_left: 10, unit_cost: 52000 },
    { product_id: "q", move_id: "d", qty_left: 2, unit_cost: null },
    { product_id: "q", move_id: "e", qty_left: 2, unit_cost: 900 },
  ];
  it("선입선출은 남은 층 중 가장 먼저 들어온 층 단가 — 마지막 입고 단가가 아니다", () => {
    const m = nextOutUnitCost(layers, "fifo");
    expect(m.get("p")).toBe(50000);
  });
  it("먼저 나갈 층에 단가가 없으면 null(미확정)", () => {
    expect(nextOutUnitCost(layers, "fifo").get("q")).toBeNull();
  });
  it("이동평균은 남은 층 가중평균", () => {
    expect(nextOutUnitCost(layers, "avg").get("p")).toBeCloseTo((3 * 50000 + 10 * 52000) / 13);
  });
});
