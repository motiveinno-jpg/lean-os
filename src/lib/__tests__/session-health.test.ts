import { describe, it, expect, vi } from "vitest";

vi.mock("../supabase", () => ({ supabase: {} }));

import { sessionProblemOf } from "../session-health";

describe("sessionProblemOf — 로그인 문제 판정", () => {
  it("다른 곳 로그인으로 밀려남", () => {
    expect(sessionProblemOf({ message: "session_gate:duplicate", code: "PT403" })).toBe("duplicate");
  });
  it("회사 IP 제한", () => {
    expect(sessionProblemOf({ message: "session_gate:ip" })).toBe("ip");
  });
  it("로그인 만료(JWT)", () => {
    expect(sessionProblemOf({ message: "JWT expired", code: "PGRST303" })).toBe("expired");
    expect(sessionProblemOf({ status: 401, message: "" })).toBe("expired");
  });
  it("일시 장애는 로그인 문제로 보지 않는다", () => {
    expect(sessionProblemOf({ message: "Failed to fetch" })).toBeNull();
    expect(sessionProblemOf({ message: "canceling statement due to statement timeout", code: "57014" })).toBeNull();
    expect(sessionProblemOf(null)).toBeNull();
  });
});
