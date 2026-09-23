import { describe, it, expect } from "vitest";
import { explainError } from "../operator-error-explain";

// 코드 ↔ DB 어긋남은 사용자가 뭘 해도 100% 실패하는 결함이라 운영자 화면에서 '심각' 이어야 한다.
//   2026-09-21~22 직원 초대가 이틀간 25번 막혔는데 '보통' 으로 분류돼 민원으로 알았다.
describe("운영자 오류 해석 — 코드와 DB 가 어긋난 오류는 심각", () => {
  it("브라우저 인터셉터 문구([DB 400] … check constraint)", () => {
    const e = explainError(
      '[DB 400] POST /rest/v1/employee_invitations — new row for relation "employee_invitations" violates check constraint "employee_invitations_role_check"',
      "manual",
    );
    expect(e.severity).toBe("critical");
    expect(e.code).toBe("db:check_mismatch");
    expect(e.what).toContain("employee_invitations");
    expect(e.why).toContain("employee_invitations_role_check");
  });

  it("react-query 뮤테이션 문구([23514] …)", () => {
    const e = explainError('[23514] new row for relation "employee_invitations" violates check constraint "employee_invitations_role_check"', "mutation");
    expect(e.severity).toBe("critical");
  });

  it("RPC 안에서 난 check 위반([DB 400] POST /rest/v1/rpc/…)", () => {
    const e = explainError(
      '[DB 400] POST /rest/v1/rpc/get_rrns_for_insurance — new row for relation "employee_rrn_access_log" violates check constraint "employee_rrn_access_log_action_check"',
    );
    expect(e.severity).toBe("critical");
  });

  it("없는 컬럼·표·함수", () => {
    expect(explainError('[DB 400] GET /rest/v1/employees?select=foo — column employees.foo does not exist').severity).toBe("critical");
    expect(explainError('[DB 404] GET /rest/v1/ghost_table — relation "public.ghost_table" does not exist').severity).toBe("critical");
    expect(explainError('[DB 404] POST /rest/v1/rpc/nope — Could not find the function public.nope(p_x) in the schema cache').severity).toBe("critical");
    expect(explainError("42703 column x does not exist").severity).toBe("critical");
  });

  it("필수값 누락은 높음", () => {
    const e = explainError('[DB 400] POST /rest/v1/employees — null value in column "company_id" of relation "employees" violates not-null constraint');
    expect(e.severity).toBe("high");
    expect(e.what).toContain("company_id");
  });

  it("사용자 쪽 사유(중복 저장)는 그대로 낮음", () => {
    const e = explainError('[DB 409] POST /rest/v1/corporate_cards — duplicate key value violates unique constraint "corporate_cards_name_key"');
    expect(e.severity).toBe("low");
  });
});
