import { describe, it, expect } from "vitest";
import { accountCostGroup, isContraAccount, buildAccountQualifiers } from "@/lib/account-label";

//   2026-09-11 사장님: "같은 게 여러 번 보인다". 표준 계정체계가 같은 비용을 원가 단계마다 따로 두기 때문인데,
//   화면이 코드만 보여 줘서 무엇이 다른지 알 수 없었다. 겹치는 이름에만 꼬리표를 붙인다.
const A = (code: string, name: string) => ({ code, name });

describe("계정 꼬리표", () => {
  it("코드 구간이 원가 단계를 말한다", () => {
    expect(accountCostGroup("526")).toBe("제조");
    expect(accountCostGroup("626")).toBe("도급");
    expect(accountCostGroup("726")).toBe("분양");
    expect(accountCostGroup("826")).toBe("판관");
    expect(accountCostGroup("967")).toBe("영업외");
    expect(accountCostGroup("")).toBeNull();
  });

  it("차감계정을 알아본다", () => {
    expect(isContraAccount("대손충당금")).toBe(true);
    expect(isContraAccount("감가상각누계액")).toBe(true);
    expect(isContraAccount("외상매출금")).toBe(false);
  });

  it("이름이 겹치는 계정에만 붙는다", () => {
    const list = [A("826", "도서인쇄비"), A("526", "도서인쇄비"), A("101", "현금")];
    const q = buildAccountQualifiers(list);
    expect(q["526"]).toBe("제조");
    expect(q["826"]).toBe("판관");
    //   하나뿐인 계정은 꼬리표가 붙지 않는다 — 전부에 붙이면 시끄럽기만 하다
    expect(q["101"]).toBeUndefined();
  });

  it("차감계정은 무엇에 붙는 것인지 적는다", () => {
    const list = [A("108", "외상매출금"), A("109", "대손충당금"), A("110", "받을어음"), A("111", "대손충당금")];
    const q = buildAccountQualifiers(list);
    expect(q["109"]).toBe("외상매출금");
    expect(q["111"]).toBe("받을어음");
  });

  it("차감계정이 줄지어 있어도 본 계정을 찾아 올라간다", () => {
    //   219 시설투자 뒤에 220·222·224 감가상각누계액이 붙어 있다(221·223 은 계정표에 없다)
    const list = [A("219", "시설투자"), A("220", "감가상각누계액"), A("222", "감가상각누계액"), A("224", "감가상각누계액")];
    const q = buildAccountQualifiers(list);
    expect(q["220"]).toBe("시설투자");
    expect(q["222"]).toBe("시설투자");
    expect(q["224"]).toBe("시설투자");
  });
});
