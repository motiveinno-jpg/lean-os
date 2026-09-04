#!/usr/bin/env node
// 블로그용 실제 화면 캡처 — 운영 오너뷰(www.owner-view.com)에 QA 시드 계정으로 들어가 지정한 화면을 찍는다.
//   QA 시드 회사는 샘플 자료만 있어 개인정보가 없다. 캡처는 public/blog/<slug>/<name>.png 로 저장한다.
//   사용: node scripts/blog-capture.mjs <slug> '<JSON 배열>'   (또는 --file shots.json)
//   항목: { name, path, waitMs?, click?: [텍스트…], clip?: "css 선택자", cut?: { lastCol|maxWidth, sidebar?, pad? }, width?, height?, scroll?: "css 선택자" }
//   예:  node scripts/blog-capture.mjs card-vat '[{"name":"card-tab","path":"/collect","click":["신용카드"],"waitMs":2500}]'
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BLOG_CAPTURE_BASE || "https://www.owner-view.com";
const EMAIL = process.env.BLOG_CAPTURE_EMAIL || "qa-seed-owner@mo-tive.com";
const PASSWORD = process.env.BLOG_CAPTURE_PASSWORD || "QaSeed!2026";   // scripts/qa-seed.mjs 와 같은 시드 계정

const [slug, spec] = process.argv.slice(2);
if (!slug || !spec) { console.error("사용: node scripts/blog-capture.mjs <slug> '<JSON>' | --file shots.json"); process.exit(1); }
const shots = spec === "--file" ? JSON.parse(fs.readFileSync(process.argv[4], "utf8")) : JSON.parse(spec);
const outDir = path.join(process.cwd(), "public", "blog", slug);
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 2100, height: 1150 }, deviceScaleFactor: 2 });
await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
await page.fill('input[type="email"], input[name="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 60000 });
//   약관 동의·투어 말풍선이 있으면 치운다 — 캡처에 끼어들면 안 된다
const clearOverlays = async () => {
  if (await page.locator("text=약관 동의가 필요합니다").count()) { const cb = page.locator("input[type=checkbox]").first(); if (await cb.count()) await cb.check().catch(() => {}); await page.getByRole("button", { name: /동의하고 계속하기/ }).click().catch(() => {}); await page.waitForTimeout(1500); }
  const never = page.locator("text=이 안내 다시 보지 않기"); if (await never.count()) { await never.first().click().catch(() => {}); await page.waitForTimeout(500); }
};
for (const s of shots) {
  await page.setViewportSize({ width: s.width || 2100, height: s.height || 1150 });
  await page.goto(BASE + s.path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await clearOverlays();
  for (const t of s.click || []) { await page.locator("button, a, [role=tab]", { hasText: t }).first().click(); await page.waitForTimeout(800); }
  if (s.scroll) await page.locator(s.scroll).first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(s.waitMs ?? 2000);
  await clearOverlays();
  const file = path.join(outDir, `${s.name}.png`);
  if (s.cut) {
    //   표를 지정한 열까지만 잘라 찍는다 — 네이버 본문은 폭 700px 라, 열을 다 넣으면 글자가 안 보인다.
    //   { lastCol: "유형" 또는 maxWidth: 1050, sidebar?: true(화면 왼쪽부터), pad?: 아래 여백 }
    const box = await page.evaluate(({ lastCol, sidebar, pad, maxWidth }) => {
      const table = document.querySelector("table.ev-table");
      if (!table) return maxWidth ? { x: 0, y: 0, width: maxWidth, height: Math.min(innerHeight, 1000) } : null;
      const ths = [...table.querySelectorAll("thead th")];
      let hit = lastCol ? ths.find((t) => t.innerText.replace(/\s+/g, " ").trim().startsWith(lastCol)) : null;
      const t = table.getBoundingClientRect();
      const rows = [...table.querySelectorAll("tbody tr")];
      const bottom = rows.length ? rows[rows.length - 1].getBoundingClientRect().bottom : t.bottom;
      //   열 이름 대신 maxWidth 를 주면, 그 폭 안에 온전히 들어오는 마지막 열에서 끊는다
      if (!hit && maxWidth) {
        const x0 = sidebar ? 0 : t.x;
        for (const th of ths) { if (th.getBoundingClientRect().right - x0 <= maxWidth) hit = th; }
      }
      let right = hit ? hit.getBoundingClientRect().right : t.right;
      //   maxWidth 를 넘기면(첫 열부터 넓은 표) 거기서 자른다 — 넓은 그림은 네이버에서 축소돼 못 읽는다
      if (maxWidth) right = Math.min(right, (sidebar ? 0 : t.x) + maxWidth);
      const x = sidebar ? 0 : Math.max(0, t.x - (pad ?? 8));
      const y = sidebar ? 0 : Math.round(t.y);   // 표만 찍을 땐 표 머리 위 줄이 걸치지 않게 딱 표부터
      //   가로는 열 경계에서 딱 끊는다(다음 열 글자가 걸치면 "잘렸다"로 보인다). 세로만 여백을 준다.
      return { x, y, width: Math.round(right - x), height: Math.round(bottom - y + (pad ?? 12)) };
    }, s.cut);
    //   표가 없는 화면이면 잘라내지 않고 화면째 찍는다(멈추지 않게)
    if (box) await page.screenshot({ path: file, clip: box });
    else { console.log(`  (표 없음 — 화면째 찍음: ${s.name})`); await page.screenshot({ path: file }); }
  }
  else if (s.clip) { const el = page.locator(s.clip).first(); await el.screenshot({ path: file }); }
  else await page.screenshot({ path: file });
  console.log("찍음:", path.relative(process.cwd(), file));
}
await browser.close();
