// 주소별 접근 판정 — 공개/로그인 필요/없는 주소(404) 세 갈래와, 목록이 src/app 실제 화면과 맞는지.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { APP_ROUTE_SEGMENTS, isPublicRoute, requiresLogin } from "@/lib/route-access";

const APP_DIR = path.resolve(__dirname, "../../app");

/** src/app 아래 page 파일 → 주소 ((묶음)은 빼고, [param] 은 샘플 값으로) */
function pageRoutes(dir = APP_DIR, parts: string[] = []): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === "api" && parts.length === 0) continue;
      const seg = /^\(.*\)$/.test(e.name) ? null : e.name.replace(/^\[.*\]$/, "sample");
      out.push(...pageRoutes(path.join(dir, e.name), seg ? [...parts, seg] : parts));
    } else if (/^page\.(tsx|ts|jsx|js)$/.test(e.name)) {
      out.push("/" + parts.join("/"));
    }
  }
  return out;
}

describe("route-access", () => {
  it("없는 주소는 로그인으로 보내지 않는다(404)", () => {
    expect(requiresLogin("/nonexistent-xyz")).toBe(false);
    expect(requiresLogin("/nonexistent-xyz/")).toBe(false);
    expect(requiresLogin("/wp-admin/")).toBe(false);
  });

  it("앱 화면은 로그인 필요", () => {
    expect(requiresLogin("/dashboard")).toBe(true);
    expect(requiresLogin("/dashboard/")).toBe(true);
    expect(requiresLogin("/projecthub/abc-123/")).toBe(true);
    expect(requiresLogin("/guide/")).toBe(true);
    expect(requiresLogin("/advisor/dashboard/")).toBe(true);
    expect(requiresLogin("/platform/errors/")).toBe(true);
  });

  it("공개 화면은 로그인 불필요", () => {
    for (const p of ["/", "/pricing/", "/tools/vat-calculator/", "/blog/abc/", "/industries/ecommerce/", "/advisor/", "/platform/", "/quote/tok/", "/survey/tok/", "/status/"]) {
      expect(isPublicRoute(p), p).toBe(true);
      expect(requiresLogin(p), p).toBe(false);
    }
  });

  it("src/app 의 모든 화면은 공개 목록이나 로그인 필요 목록 둘 중 하나에 있다", () => {
    const routes = pageRoutes();
    expect(routes.length).toBeGreaterThan(50);
    const orphan = routes.filter((r) => !isPublicRoute(r) && !isPublicRoute(`${r}/`) && !requiresLogin(r));
    expect(orphan).toEqual([]);
  });

  it("로그인 필요 목록에 실제 없는 주소가 남아 있지 않다", () => {
    const firsts = new Set(pageRoutes().map((r) => r.split("/")[1]));
    const stale = APP_ROUTE_SEGMENTS.filter((s) => !firsts.has(s));
    expect(stale).toEqual([]);
  });
});
