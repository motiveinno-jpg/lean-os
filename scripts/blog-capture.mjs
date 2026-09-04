#!/usr/bin/env node
// 블로그용 실제 화면 캡처 — 운영 오너뷰(www.owner-view.com)에 QA 시드 계정으로 들어가 지정한 화면을 찍는다.
//   QA 시드 회사는 샘플 자료만 있어 개인정보가 없다. 캡처는 public/blog/<slug>/<name>.png 로 저장한다.
//   사용: node scripts/blog-capture.mjs <slug> '<JSON 배열>'   (또는 --file shots.json)
//   항목: { name, path, waitMs?, click?: [텍스트…], clip?: "css 선택자", width?, height?, scroll?: "css 선택자" }
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
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
  await page.setViewportSize({ width: s.width || 1440, height: s.height || 900 });
  await page.goto(BASE + s.path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await clearOverlays();
  for (const t of s.click || []) { await page.locator("button, a, [role=tab]", { hasText: t }).first().click(); await page.waitForTimeout(800); }
  if (s.scroll) await page.locator(s.scroll).first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(s.waitMs ?? 2000);
  await clearOverlays();
  const file = path.join(outDir, `${s.name}.png`);
  if (s.clip) { const el = page.locator(s.clip).first(); await el.screenshot({ path: file }); }
  else await page.screenshot({ path: file });
  console.log("찍음:", path.relative(process.cwd(), file));
}
await browser.close();
