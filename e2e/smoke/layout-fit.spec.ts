// 작은 창(사이드바·탭 옆 '작은 화면으로 열기' 820×600)과 휴대폰 폭에서 떠서 열리는 칸이 화면 밖으로 잘리지 않는지.
//   메뉴마다 검색조건 패널 · 그 안 달력 · 조회 줄 달력 · 표 머리 열 거르기를 열어 보고, 떠 있는 칸이 화면 안에 있는지 잰다.
import { test, expect, type Page } from "@playwright/test";
import fs from "fs";
import { openPage } from "./helpers";

function sidebarRoutes(): string[] {
  const src = fs.readFileSync("src/components/sidebar.tsx", "utf8");
  const out = new Set<string>();
  for (const m of src.matchAll(/\{\s*href:\s*"([^"]+)",\s*label:\s*"([^"]+)"([^}]*)\}/g)) {
    if (/operatorOnly:\s*true/.test(m[3]) || !m[1].startsWith("/")) continue;
    out.add(m[1]);
  }
  return [...out];
}

/** 지금 화면에 떠 있는 칸 중 화면 밖으로 나간 것 */
async function offscreen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    const vw = innerWidth, vh = innerHeight;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const cs = getComputedStyle(el);
      if (cs.position !== "absolute" && cs.position !== "fixed") continue;
      const z = parseInt(cs.zIndex, 10);
      if (!Number.isFinite(z) || z < 10 || cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 24) continue;
      if (r.width >= vw * 0.95 && r.height >= vh * 0.9) continue;
      if (r.left < -2 || r.top < -2 || r.right > vw + 2 || r.bottom > vh + 2) {
        bad.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 2).join(".")} [${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)}] / 화면 ${vw}×${vh}`);
      }
    }
    return bad;
  });
}

async function tryOpen(page: Page, sel: string, within?: string): Promise<string[] | null> {
  const loc = (within ? page.locator(within).locator(sel) : page.locator(sel)).first();
  if (!(await loc.isVisible().catch(() => false))) return null;
  await loc.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  return offscreen(page);
}

for (const vp of [{ name: "작은 창", width: 820, height: 600 }, { name: "휴대폰", width: 390, height: 780 }]) {
  test.describe(`떠서 열리는 칸이 화면 안에 — ${vp.name} ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    for (const href of sidebarRoutes()) {
      test(href, async ({ page }) => {
        await openPage(page, href.includes("?") ? href + "&embed=1" : href + "?embed=1");
        const found: string[] = [];
        const add = (what: string, list: string[] | null) => { if (list?.length) found.push(`${what}: ${list.join(" | ")}`); };
        add("검색조건", await tryOpen(page, ".qk-cond-btn"));
        add("검색조건 › 달력", await tryOpen(page, ".drf-calopen", ".qk-panel"));
        await page.keyboard.press("Escape"); await page.mouse.click(2, 2); await page.waitForTimeout(300);
        add("조회 줄 달력", await tryOpen(page, ".drf-calopen"));
        await page.keyboard.press("Escape"); await page.mouse.click(2, 2); await page.waitForTimeout(300);
        add("열 거르기", await tryOpen(page, ".th-filter"));
        await page.keyboard.press("Escape"); await page.mouse.click(2, 2); await page.waitForTimeout(300);
        //   조회 줄 오른쪽의 펼침 버튼(엑셀 ▾ · AI 제안 ▾ · 발행 ▾ …) — 화면 오른쪽 끝에 붙어 있어 잘리기 쉽다
        const carets = page.locator(".qk-bar-right button", { hasText: "▾" });
        const n = Math.min(await carets.count().catch(() => 0), 3);
        for (let i = 0; i < n; i++) {
          const b = carets.nth(i);
          if (!(await b.isVisible().catch(() => false))) continue;
          const label = ((await b.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
          await b.click({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(400);
          add(`'${label}' 메뉴`, await offscreen(page));
          await page.keyboard.press("Escape"); await page.mouse.click(2, 2); await page.waitForTimeout(300);
        }
        //   검색조건 안 고르기 목록(거래처·계정 등) — 칸에 들어가면 후보 목록이 뜬다
        if (await tryOpen(page, ".qk-cond-btn") !== null) {
          const tok = page.locator(".qk-panel .qk-tok-box input").first();
          if (await tok.isVisible().catch(() => false)) {
            await tok.click().catch(() => {}); await page.waitForTimeout(500);
            add("검색조건 › 고르기 목록", await offscreen(page));
          }
          await page.keyboard.press("Escape"); await page.mouse.click(2, 2);
        }
        expect(found, "화면 밖으로 잘린 칸").toEqual([]);
      });
    }
  });
}
