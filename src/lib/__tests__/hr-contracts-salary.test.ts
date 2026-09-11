import { describe, it, expect } from "vitest";
import { buildVariableMap } from "@/lib/hr-contracts";

//   employees.salary 는 **월 급여** 다 — 구성원 상세가 입력받은 연봉을 12로 나눠 저장한다.
//   계약서 자동 채움이 그 값을 다시 12로 나누는 바람에 연봉·월급여·기본급이 전부 12분의 1이었다.
//   서명이 끝나면 complete-signing 이 '연봉'을 다시 12로 나눠 employees.salary 에 덮어쓰므로,
//   여기가 틀리면 종이뿐 아니라 직원의 실제 월급이 박살난다. 왕복이 제자리로 오는지까지 본다.

const emp = { name: "홍길동", salary: 2_500_000, hire_date: "2026-01-02" };
const company = { name: "테스트 주식회사", representative: "대표" };
const num = (s: string) => Number(String(s).replace(/[^0-9-]/g, ""));

describe("계약서 급여 변수", () => {
  it("연봉은 월급의 12배다", () => {
    const v = buildVariableMap(emp, company);
    expect(num(v.연봉)).toBe(30_000_000);
    expect(num(v.월급여)).toBe(2_500_000);
  });

  it("영문 키도 같은 값을 본다", () => {
    const v = buildVariableMap(emp, company);
    expect(num(v.salary_amount)).toBe(30_000_000);
  });

  it("서명 완료가 연봉을 12로 나눠 되쓸 때 원래 월급으로 돌아온다", () => {
    const v = buildVariableMap(emp, company);
    //   complete-signing 이 하는 계산: Math.round(meta.salary / 12) → employees.salary
    expect(Math.round(num(v.연봉) / 12)).toBe(emp.salary);
  });

  it("연봉 구성표의 월 합계가 월급과 같다", () => {
    const v = buildVariableMap(emp, company);
    const total = v.연봉구성표.split("\n").find((l) => l.includes("월 합계"));
    expect(num(total || "")).toBe(2_500_000);
  });

  it("기본급·고정연장·식대를 더하면 월급이 된다", () => {
    const v = buildVariableMap(emp, company);
    expect(num(v.기본급) + num(v.고정연장근로수당) + num(v.식대)).toBe(2_500_000);
  });

  it("급여가 없으면 0이고 터지지 않는다", () => {
    const v = buildVariableMap({ name: "무급" }, company);
    expect(num(v.연봉)).toBe(0);
    expect(num(v.월급여)).toBe(0);
  });
});
