import { describe, it, expect } from "vitest";
import {
  parseCheckDef, buildAllowMap, scanSource, scanSqlBody, candidateLiterals, checkFindings,
} from "../check-db-enum-literals.mjs";

describe("parseCheckDef — pg_get_constraintdef 를 허용값으로", () => {
  it("ANY(ARRAY[...]) 꼴", () => {
    const r = parseCheckDef("CHECK ((role = ANY (ARRAY['employee'::text, 'admin'::text])))");
    expect(r.column).toBe("role");
    expect([...r.values]).toEqual(["employee", "admin"]);
  });
  it("단일 = 꼴", () => {
    const r = parseCheckDef("CHECK ((role = 'member'::text))");
    expect([...r.values]).toEqual(["member"]);
  });
  it("NULL 허용 + 목록", () => {
    const r = parseCheckDef("CHECK (((paid_by IS NULL) OR (paid_by = ANY (ARRAY['personal'::text, 'corporate_card'::text]))))");
    expect(r.column).toBe("paid_by");
    expect(r.values.has("corporate_card")).toBe(true);
  });
  it("LIKE 가지는 prefix 허용", () => {
    const r = parseCheckDef("CHECK (((leave_type = ANY (ARRAY['annual'::text, 'sick'::text])) OR (leave_type ~~ 'custom\\_%'::text)))");
    expect(r.likes[0].test("custom_abc")).toBe(true);
    expect(r.likes[0].test("customabc")).toBe(false);
  });
  it("두 컬럼 관계식·숫자 배열은 건너뛴다", () => {
    expect(parseCheckDef("CHECK ((((kind = 'money'::text) AND (money_kind IS NOT NULL)) OR ((kind <> 'money'::text) AND (money_kind IS NULL))))")).toBeNull();
    expect(parseCheckDef("CHECK ((priority = ANY (ARRAY[0, 1, 2])))")).toBeNull();
    expect(parseCheckDef("CHECK ((amount > (0)::numeric))")).toBeNull();
  });
});

describe("candidateLiterals — 값 자리의 리터럴만", () => {
  it("리터럴·삼항 가지·|| 는 본다", () => {
    expect(candidateLiterals(`'member'`)).toEqual(["member"]);
    expect(candidateLiterals(`ok ? 'a' : 'b'`)).toEqual(["a", "b"]);
    expect(candidateLiterals(`params.role || 'member'`)).toEqual(["member"]);
    expect(candidateLiterals(`x ?? "fallback"`)).toEqual(["fallback"]);
  });
  it("삼항 조건·비교 대상·함수 인자·템플릿은 안 본다", () => {
    expect(candidateLiterals(`result.confidence === 'high' ? 'auto_mapped' : 'unmapped'`)).toEqual(["auto_mapped", "unmapped"]);
    expect(candidateLiterals(`m.type === "adjustment" ? "rejected" : "suggested"`)).toEqual(["rejected", "suggested"]);
    expect(candidateLiterals(`a === 'x' ? (b === 'y' ? 'p' : 'q') : 'r'`)).toEqual(["r"]);
    expect(candidateLiterals(`normalize('raw')`)).toEqual([]);
    expect(candidateLiterals("`custom_${id}`")).toEqual([]);
    expect(candidateLiterals(`JSON.stringify({ label: 'x' })`)).toEqual([]);
  });
});

describe("scanSource — .from().insert/update/upsert 1단계 리터럴", () => {
  const src = `
    const { data } = await db.from('employee_invitations').insert({
      company_id: params.companyId,
      role: params.role || 'member',
      status: cond ? 'pending' : "cancelled",
      meta: { type: 'nested_ignored' },
    }).select().single();
    await supabase.from("employees").update({ status: "invited" }).eq("id", id);
    await admin.from("email_optouts").upsert({ email, source: status === "bounced" ? "bounce" : "complaint" }, { onConflict: "email" });
    await supabase.from("notifications").insert([{ type: 'system' }, { type: "billing" }]);
    const rows = await db.from('employees').select('*');
    await db.from('x').update({ kind: 'skipme' }); // db-enum-ok 사유: 테스트
  `;
  const found = scanSource(src);
  const key = (f) => `${f.table}.${f.column}=${f.value}`;
  it("표·컬럼·값을 뽑는다", () => {
    const keys = found.map(key);
    expect(keys).toContain("employee_invitations.role=member");
    expect(keys).toContain("employee_invitations.status=pending");
    expect(keys).toContain("employee_invitations.status=cancelled");
    expect(keys).toContain("employees.status=invited");
    expect(keys).toContain("email_optouts.source=bounce");
    expect(keys).toContain("email_optouts.source=complaint");
    expect(keys).toContain("notifications.type=system");
    expect(keys).toContain("notifications.type=billing");
  });
  it("중첩 객체·select·db-enum-ok 줄은 건너뛴다", () => {
    const keys = found.map(key);
    expect(keys.some((k) => k.includes("nested_ignored"))).toBe(false);
    expect(keys.some((k) => k.includes("bounced"))).toBe(false);
    expect(keys.some((k) => k.startsWith("x."))).toBe(false);
  });
  it("줄 번호를 준다", () => {
    const f = found.find((x) => x.value === "invited");
    expect(f.line).toBe(8);
  });
});

describe("scanSqlBody — DB 함수 본문", () => {
  it("insert … values 와 update … set 의 리터럴", () => {
    const body = `
      begin
        insert into public.employee_rrn_access_log (company_id, action, note) values (v_company, 'get_insurance', 'x');
        update notifications set type = 'system', title = v_t where id = v_id;
        insert into other (a) select 1;
      end`;
    const f = scanSqlBody(body).map((x) => `${x.table}.${x.column}=${x.value}`);
    expect(f).toContain("employee_rrn_access_log.action=get_insurance");
    expect(f).toContain("notifications.type=system");
    expect(f.some((k) => k.startsWith("other."))).toBe(false);
  });
});

describe("checkFindings — 대조", () => {
  const allow = buildAllowMap([
    { tbl: "employee_invitations", conname: "c1", def: "CHECK ((role = ANY (ARRAY['employee'::text, 'admin'::text])))" },
    { tbl: "leave_requests", conname: "c2", def: "CHECK (((leave_type = ANY (ARRAY['annual'::text])) OR (leave_type ~~ 'custom\\_%'::text)))" },
  ]);
  it("허용값 밖이면 위반, 안이면 통과, 제약 없는 표·컬럼은 무시", () => {
    const bad = checkFindings([
      { table: "employee_invitations", column: "role", value: "member", line: 1 },
      { table: "employee_invitations", column: "role", value: "admin", line: 2 },
      { table: "employee_invitations", column: "email", value: "whatever", line: 3 },
      { table: "leave_requests", column: "leave_type", value: "custom_x", line: 4 },
      { table: "leave_requests", column: "leave_type", value: "sick", line: 5 },
      { table: "unknown_table", column: "status", value: "zzz", line: 6 },
    ], allow);
    expect(bad.map((b) => b.line)).toEqual([1, 5]);
    expect(bad[0].allowed).toEqual(["employee", "admin"]);
  });
});
