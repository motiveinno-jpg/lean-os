// 사이드바 메뉴 전 화면을 QA 마스터로 열어 깨진 화면이 없는지 본다.
//   메뉴 목록은 sidebar.tsx 에서 읽는다 — 메뉴가 늘면 점검도 저절로 늘어난다(목록을 따로 관리하지 않는다).
import { test } from "@playwright/test";
import fs from "fs";
import { openPage, expectHealthy } from "./helpers";

function sidebarRoutes(): { href: string; label: string }[] {
  const src = fs.readFileSync("src/components/sidebar.tsx", "utf8");
  const out = new Map<string, string>();
  for (const m of src.matchAll(/\{\s*href:\s*"([^"]+)",\s*label:\s*"([^"]+)"([^}]*)\}/g)) {
    const [, href, label, rest] = m;
    if (/operatorOnly:\s*true/.test(rest)) continue;   // 운영자 전용 메뉴는 QA 회사 계정에 안 보인다
    if (!href.startsWith("/")) continue;
    if (!out.has(href)) out.set(href, label);
  }
  return [...out.entries()].map(([href, label]) => ({ href, label }));
}

//   사이드바 밖이지만 자주 쓰는 화면
const EXTRA = [
  { href: "/settings/integration/?tab=bank", label: "설정 › 은행연동" },
  { href: "/approvals/?tab=new-request", label: "결재 허브 › 새 요청" },
];

const routes = [...sidebarRoutes(), ...EXTRA];

test.describe("화면 열기 — 사이드바 전 메뉴", () => {
  test("메뉴 목록을 읽었다", () => { test.expect(routes.length).toBeGreaterThan(20); });
  for (const r of routes) {
    test(`${r.label} (${r.href})`, async ({ page }) => {
      const info = await openPage(page, r.href);
      await expectHealthy(page, r.href, info);
    });
  }
});
