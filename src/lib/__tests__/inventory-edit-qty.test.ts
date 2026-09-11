import { describe, it, expect } from "vitest";
import { editQtyOf, reasonOf } from "@/lib/inventory";

//   전표를 열어서 아무것도 안 고치고 [저장]만 눌러도 재고가 틀어지던 문제.
//   저장은 `입력값 × 사유부호` 로 부호를 붙이는데, 되읽을 때 Math.abs 를 써서
//   반품 전표(사유 'sale' 인데 수량이 +)가 뒤집혔다. 왕복이 제자리인지 고정한다.

/** 저장 경로가 하는 일 — createStockDoc/updateStockDoc 의 `raw * def.sign` */
const save = (qty: number, reason: string) => qty * (reasonOf(reason)?.sign ?? 1);

describe("전표 수량 왕복", () => {
  it("판매 전표: 50개 저장 → 열기 → 저장해도 그대로다", () => {
    const stored = save(50, "sale");
    expect(stored).toBe(-50);                       // 재고에서 50개 빠짐
    const shown = editQtyOf({ qty: stored }, "sale");
    expect(shown).toBe(50);                         // 화면에는 50개
    expect(save(shown, "sale")).toBe(stored);       // 다시 저장해도 −50
  });

  it("반품 전표: 사유는 판매인데 재고가 늘어난다 — 열었다 저장해도 안 뒤집힌다", () => {
    //   returnStockDoc 이 만든 줄: 재고 +50, 사유는 'sale' 그대로
    const stored = 50;
    const shown = editQtyOf({ qty: stored }, "sale");
    expect(shown).toBe(-50);                        // 화면에는 −50(되돌린 수량)
    expect(save(shown, "sale")).toBe(stored);       // 저장하면 다시 +50
    //   예전 방식이었다면 abs 로 50 → 저장 시 −50 이 되어 100개가 틀어졌다
    expect(save(Math.abs(stored), "sale")).toBe(-50);
  });

  it("매입 전표도 같다", () => {
    const stored = save(30, "purchase");
    expect(stored).toBe(30);
    expect(editQtyOf({ qty: stored }, "purchase")).toBe(30);
    //   매입 반품(재고 −30)도 부호를 지키며 되돌아온다
    expect(editQtyOf({ qty: -30 }, "purchase")).toBe(-30);
  });

  it("빈 값·모르는 사유도 터지지 않는다", () => {
    expect(editQtyOf({ qty: null }, "sale")).toBe(-0);
    expect(editQtyOf({ qty: 7 }, "무슨사유")).toBe(7);
  });
});
