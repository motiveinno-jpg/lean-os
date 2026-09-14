// 서비스 소개서 v3 — 제품 화면 캡처 (2026-09-14)
//   사용: node deck/service-v3/capture.mjs            (Git Bash 면 MSYS_NO_PATHCONV=1 을 앞에 붙인다 — /dashboard 가 경로로 바뀐다)
//   결과: deck/service-v3/shots/dk-*.png (2배 해상도)
//
//   ⛔ QA 시드 회사(가상)에서만 찍는다 (결정 220·239 — 소개서에 모티브 실데이터·회사 노출 없음).
//      계정 = qa-seed-owner@mo-tive.com. 비밀번호는 저장소에 적지 않는다 — QA_SEED_PASSWORD 환경변수나 git 제외 파일 .env.qa.local.
//      (대표 계정은 쓰지 않는다: 모티브 데이터가 찍히고, 계정당 세션 1개라 대표 화면이 튕긴다.)
//   ⚠️ 운영(www.owner-view.com)을 읽기만 한다. 데이터를 만들지 않는다.
//   ⚠️ 대시보드는 찍지 않는다 — 날짜 줄에 「QA시드 주식회사」가 나오고, 무료 요금제라 AI 브리핑이 아닌 「규칙 요약」이 뜬다(표지·8쪽은 f-ai-brief-v4).
//   ⚠️ 수집·전표는 찍지 않는다 — QA 시드는 무료 요금제라 「유료 요금제 기능」 줄만 나온다(6쪽은 08-20 f-bank-v4 를 머리만 잘라 쓴다).
//   ⚠️ 보고서 화면은 본문이 안쪽 스크롤이라 창을 세로로 키워(1400) 한 번에 보이게 한다.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const req = createRequire(path.join(root, "package.json"));
const { chromium } = req("playwright");

const BASE = process.env.BASE || "https://www.owner-view.com";
const EMAIL = "qa-seed-owner@mo-tive.com";
let PW = process.env.QA_SEED_PASSWORD;
const local = path.join(root, ".env.qa.local");
if (!PW && fs.existsSync(local)) PW = fs.readFileSync(local, "utf8").match(/^QA_SEED_PASSWORD=(.+)$/m)?.[1]?.trim();
if (!PW) throw new Error("QA_SEED_PASSWORD 가 없습니다 (환경변수 또는 .env.qa.local)");

const OUT = path.join(here, "shots");
fs.mkdirSync(OUT, { recursive: true });

// [파일명, 주소, 자를 블록, 최대 높이(css px), 탭 글자]
const SHOTS = [
  ["dk-summary",   "/reports/summary", ".bz-body",                          640],
  ["dk-outlook",   "/reports/outlook", ".bz-body",                          700],
  ["dk-taxinv",    "/tax-invoices",    ".app-content-scale",                600],
  ["dk-taxfiling", "/finance/tax-filing", ".app-content-scale",             600, "부가세"],
  ["dk-support",   "/support-programs", ".qk-screen",                       720],
];

const HIDE = `.messenger-fab, .toast-container, [data-tour] { display: none !important; }`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1560, height: 1400 }, deviceScaleFactor: 2, locale: "ko-KR", timezoneId: "Asia/Seoul" });
const page = await ctx.newPage();
await page.goto(`${BASE}/auth/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);   // 하이드레이션 전에 채우면 로그인이 안 된다
await page.locator('input[type="email"]').first().fill(EMAIL);
await page.locator('input[type="password"]').first().fill(PW);
await page.locator('button[type="submit"]').first().click();
await page.waitForURL(/dashboard/, { timeout: 60000 });

for (const [name, route, sel, maxH, tab] of SHOTS) {
  await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(sel, { timeout: 45000 });
  await page.waitForTimeout(5000);   // 표·차트가 다 그려진 뒤
  await page.addStyleTag({ content: HIDE }).catch(() => {});
  if (tab) { await page.locator(`.collect-tabs button:has-text("${tab}")`).first().click(); await page.waitForTimeout(2000); }
  const box = await page.evaluate(([s, h]) => {
    const r = document.querySelector(s).getBoundingClientRect();
    const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y));
    return { x, y, width: Math.round(Math.min(r.width, innerWidth - x)), height: Math.round(Math.min(r.height, h, innerHeight - y)) };
  }, [sel, maxH]);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), clip: box });
  console.log(`   ${name}.png  ${box.width}x${box.height}`);
}
await browser.close();
