import { describe, expect, it } from "vitest";
import { applyDayOrder, moveKey } from "@/lib/schedule-day-order";

const ev = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("applyDayOrder", () => {
  it("저장된 순서대로", () => {
    expect(ids(applyDayOrder(ev("a", "b", "c"), ["c", "a", "b"]))).toEqual(["c", "a", "b"]);
  });
  it("순서에 없는 새 일정은 원래 순서대로 뒤에", () => {
    expect(ids(applyDayOrder(ev("a", "new1", "b", "new2"), ["b", "a"]))).toEqual(["b", "a", "new1", "new2"]);
  });
  it("지워진 일정 키는 무시", () => {
    expect(ids(applyDayOrder(ev("a", "b"), ["gone", "b", "a"]))).toEqual(["b", "a"]);
  });
  it("저장된 순서가 없으면 그대로", () => {
    expect(ids(applyDayOrder(ev("a", "b"), undefined))).toEqual(["a", "b"]);
  });
});

describe("moveKey", () => {
  it("앞으로", () => expect(moveKey(["a", "b", "c", "d"], "d", "b", true)).toEqual(["a", "d", "b", "c"]));
  it("뒤로", () => expect(moveKey(["a", "b", "c", "d"], "a", "c", false)).toEqual(["b", "c", "a", "d"]));
  it("자기 자신·없는 키는 그대로", () => {
    expect(moveKey(["a", "b"], "a", "a", true)).toEqual(["a", "b"]);
    expect(moveKey(["a", "b"], "x", "a", true)).toEqual(["a", "b"]);
  });
  it("반복 회차 키도 같은 규칙", () => expect(moveKey(["m@20260929", "a"], "a", "m@20260929", true)).toEqual(["a", "m@20260929"]));
});
