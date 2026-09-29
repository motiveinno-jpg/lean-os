import { describe, it, expect } from "vitest";
import { countQuoteContract, countQuoteContractAcross, lastActivityByDeal, quietDaysOf, tallySignals, isFlowColumn } from "../project-v3-rollup";

const G = "#00C875";
const quoteCol = { deal_id: "d1", key: "견적", name: "견적", type: "select", settings: { options: [{ id: "wait", color: "#9aa0b5" }, { id: "sent", color: "#FDAB3D" }, { id: "ok", color: G }] } };
const contractCol = { deal_id: "d1", key: "계약", name: "계약", type: "select", settings: { options: [{ id: "wait", color: "#9aa0b5" }, { id: "done", color: G }] } };
const kindCol = { deal_id: "d1", key: "유형", name: "견적 유형", type: "select", settings: { options: [{ id: "a", color: "#111" }, { id: "b", color: "#222" }] } };

describe("countQuoteContract", () => {
  it("흐름 칸 끝(확정·완료)과 붙은 문서를 함께 센다", () => {
    const items = [
      { deal_id: "d1", fields: { 견적: "ok", 계약: "done" } },
      { deal_id: "d1", fields: { 견적: "ok", 계약: "wait" } },
      { deal_id: "d1", fields: { 견적: "sent" } },
      { deal_id: "d1", fields: { __quote: { id: "q" } } },
      { deal_id: "d1", fields: { __contract: { id: "c" } } },
      { deal_id: "d1", parent_id: "x", fields: { 견적: "ok" } }, // 하위 줄은 제외
    ];
    expect(countQuoteContract(items, [quoteCol, contractCol, kindCol])).toEqual({ quoteN: 3, contractN: 2 });
  });
  it("분류 select 는 흐름 칸이 아니다", () => {
    expect(isFlowColumn(kindCol)).toBe(false);
    expect(isFlowColumn(quoteCol)).toBe(true);
  });
  it("여러 프로젝트는 각자 칸으로 판정", () => {
    const items = [{ deal_id: "d1", fields: { 견적: "ok" } }, { deal_id: "d2", fields: { 견적: "ok" } }];
    expect(countQuoteContractAcross(items, [quoteCol])).toEqual({ quoteN: 1, contractN: 0 });
  });
});

describe("lastActivityByDeal", () => {
  it("표 줄 수정이 옛 업무·생성 시각보다 최신이면 그것을 쓴다", () => {
    const m = lastActivityByDeal({
      deals: [{ id: "d1", created_at: "2026-06-24T00:00:00Z" }],
      items: [{ deal_id: "d1", updated_at: "2026-09-28T00:00:00Z" }],
      tasks: [],
    });
    expect(quietDaysOf(m.d1, new Date("2026-09-29T00:00:00Z").getTime())).toBe(1);
  });
});

describe("tallySignals", () => {
  it("진행 중 프로젝트 전부가 한 칸에 들어간다", () => {
    const t = tallySignals(["a", "b", "c", "d"], [{ deal_id: "a", signal: "red" }, { deal_id: "a", signal: "blue" }, { deal_id: "z", signal: "blue" }]);
    expect(t).toEqual({ blue: 0, orange: 0, red: 1, none: 3 });
    expect(t.blue + t.orange + t.red + t.none).toBe(4);
  });
});
