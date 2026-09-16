// 메뉴별 제품 화면 캡처 (2026-09-16) — /demo · /features · 랜딩 메가메뉴가 쓰는 f-*.png 를 다시 찍는다.
//
//   왜 필요한가: catalog 의 캡처 51장 중 33장이 8월 판이었다. 그 사이 프로젝트 v3 전환·인사 자동화·
//     세무 모듈·조회 화면 표준이 들어가 메뉴 이름과 화면이 달라졌다. 옛 캡처는 없는 메뉴를 보여 준다.
//
//   쓰는 법
//     node scripts/capture-menu-shots.mjs                    # 목록 전체
//     node scripts/capture-menu-shots.mjs cards partners     # 고른 것만 (SHOTS 의 key)
//     node scripts/capture-menu-shots.mjs --list             # 무엇을 찍는지만 보기
//
//   ⚠️ **QA 시드 회사(가상)에서만 찍는다** (결정 220). 2026-09-07 히어로 영상에 실제 거래처명·미수금이
//      나간 사고가 있었다. 모티브 계정으로 찍지 않는다.
//   ⚠️ 프로덕션을 **읽기만** 한다. 데이터를 만들지 않는다.
//   ⚠️ 기존 파일을 덮지 않는다 — 번호를 올려 새 파일로 저장하고 catalog.ts 를 함께 고친다.
//      덮으면 CDN·브라우저 캐시 때문에 옛 그림이 계속 나온다.
//   ⚠️ 계정 비밀번호는 .env.qa.local(git 제외) 에서만 읽는다. 출력하지 않는다.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const req = createRequire(path.join(process.env.REPO || process.cwd(), "package.json"));
const { chromium } = req("playwright");

const BASE = process.env.BASE || "https://www.owner-view.com";
const OUT = path.join(process.cwd(), "public", "product");

//   캡처 구도 — 사이드바를 뺀 「크롬 헤더(브레드크럼) + 본문」. 데모가 왼쪽에 제 사이드바를 붙여
//   실제 앱 화면처럼 이어 붙이므로 이 구도를 바꾸면 데모가 어긋난다.
//   1426 - 사이드바 280 = 1146. 2배 해상도로 2292×1800 이 나온다(9월 판과 같은 규격).
const VIEW = { width: 1426, height: 900 };
const SIDEBAR = 280;

// ── 계정 (capture-landing-shots.mjs 와 같은 방식) ──
const EMAIL = process.env.BLOG_CAPTURE_EMAIL
  || fs.readFileSync(path.join(process.cwd(), "scripts", "blog-capture.mjs"), "utf8")
       .match(/BLOG_CAPTURE_EMAIL \|\| "([^"]+)"/)?.[1];
let PW = process.env.QA_SEED_PASSWORD || process.env.BLOG_CAPTURE_PASSWORD;
if (!PW) {
  const local = path.join(process.cwd(), ".env.qa.local");
  if (fs.existsSync(local)) PW = fs.readFileSync(local, "utf8").match(/^QA_SEED_PASSWORD=(.+)$/m)?.[1]?.trim();
}
if (!EMAIL || !PW) throw new Error("QA 시드 계정이 없습니다 — .env.qa.local 의 QA_SEED_PASSWORD 를 확인하세요");

/* ── 무엇을 찍는가 ────────────────────────────────────────────────
   name 은 catalog.ts 의 shot() 이름과 같아야 한다. 기존 이름의 번호를 하나 올린다.
   ready 는 그 화면에서 자료가 다 그려졌음을 알리는 선택자(없으면 시간만 기다린다). */
const SHOTS = [
  { key: "notifications", route: "/notifications",  name: "f-notifications-v2" },
  { key: "mypage",        route: "/mypage",         name: "f-mypage-v2" },
  { key: "copilot",       route: "/copilot",        name: "f-ai-copilot-v6" },
  { key: "bank",          route: "/bank",           name: "f-bank2-v5",   ready: "table" },
  { key: "cards",         route: "/cards",          name: "f-cards-v5",   ready: "table" },
  { key: "partners",      route: "/partners",       name: "f-partners-v5", ready: "table" },
  { key: "collect",       route: "/collect",        name: "f-bank-v5",    ready: "table" },
  { key: "tax-invoices",  route: "/tax-invoices",   name: "f-tax-v5",     ready: "table" },
  { key: "voucher",       route: "/partners/reconciliation/voucher-entry", name: "f-voucher-v5" },
  { key: "salepurchase",  route: "/partners/reconciliation/sale-purchase", name: "f-salepurchase-v2" },
  { key: "assets",        route: "/finance/assets", name: "f-assets-v1" },   // 캡처가 아예 없던 메뉴
  { key: "payments",      route: "/payments",       name: "f-payments-v5" },
  { key: "schedule",      route: "/schedule",       name: "f-schedule-v5" },
  { key: "approvals",     route: "/approvals",      name: "f-approvals-v5" },
  { key: "board",         route: "/board",          name: "f-board-v5" },
  { key: "chat",          route: "/chat",           name: "f-chat-v5" },
  { key: "signatures",    route: "/signatures",     name: "f-contract-v5" },
  { key: "documents",     route: "/documents",      name: "f-documents-v5" },
  { key: "team",          route: "/team",           name: "f-team-v2" },
  { key: "employees",     route: "/employees",      name: "f-members-v5" },
  { key: "attendance",    route: "/attendance",     name: "f-hr-v6" },
  { key: "hr-templates",  route: "/hr-templates",   name: "f-templates-v5" },
  { key: "summary",       route: "/reports/summary", name: "f-acct-v5" },
  { key: "profit",        route: "/reports/profit", name: "f-profit-v2" },
  { key: "outlook",       route: "/reports/outlook", name: "f-flow-v5" },
  { key: "statements",    route: "/reports/statements", name: "f-statements-v2" },
  { key: "ledger",        route: "/partners/ledger", name: "f-ledger-v2" },
  { key: "vat",           route: "/reports/vat",    name: "f-vat-v2" },
  { key: "settings",      route: "/settings/company", name: "f-settings-v2" },
  { key: "billing",       route: "/billing",        name: "f-billing-v2" },
  { key: "announcements", route: "/announcements",  name: "f-announcements-v2" },
  { key: "guide",         route: "/guide",          name: "f-guide-v2" },
  { key: "support",       route: "/support",        name: "f-support-v2" },
];

const args = process.argv.slice(2);
if (args.includes("--list")) {
  for (const s of SHOTS) console.log(`  ${s.key.padEnd(15)} ${s.route.padEnd(40)} → ${s.name}.png`);
  process.exit(0);
}
const picked = args.filter((a) => !a.startsWith("--"));
const wanted = picked.length ? SHOTS.filter((s) => picked.includes(s.key)) : SHOTS;

// 캡처에 끼어드는 것만 감춘다 (제품에는 그대로 있다)
const HIDE = `.messenger-fab, .toast-container, [data-tour], .global-search-overlay { display: none !important; }`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: VIEW, deviceScaleFactor: 2, locale: "ko-KR", timezoneId: "Asia/Seoul",
});
const page = await ctx.newPage();

console.log("로그인 (QA 시드)");
await page.goto(`${BASE}/auth/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);   // 하이드레이션 전에 채우면 리액트 상태가 비어 로그인이 안 된다
await page.locator('input[type="email"]').first().fill(EMAIL);
await page.locator('input[type="password"]').first().fill(PW);
await page.locator('button[type="submit"]').first().click();
await page.waitForURL(/dashboard/, { timeout: 60000 });
console.log("   ok");

fs.mkdirSync(OUT, { recursive: true });
const done = [], failed = [];

for (const s of wanted) {
  try {
    await page.goto(BASE + s.route, { waitUntil: "domcontentloaded" });
    if (s.ready) await page.waitForSelector(s.ready, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(4500);   // 표·차트가 다 그려진 뒤에 찍는다
    await page.addStyleTag({ content: HIDE }).catch(() => {});

    //   사이드바 오른쪽 끝부터 화면 끝까지. 헤더(브레드크럼)를 포함하려고 y 는 0 에서 시작한다.
    const clip = { x: SIDEBAR, y: 0, width: VIEW.width - SIDEBAR, height: VIEW.height };
    const file = path.join(OUT, `${s.name}.png`);
    if (fs.existsSync(file)) { console.log(`   ! ${s.name}.png 이미 있음 — 건너뜀(번호를 올리세요)`); continue; }
    await page.screenshot({ path: file, clip });
    console.log(`   ${s.name}.png  ${clip.width}x${clip.height} (css)  ← ${s.route}`);
    done.push(s.name);
  } catch (e) {
    console.log(`   ✗ ${s.key} 실패: ${e.message.slice(0, 120)}`);
    failed.push(s.key);
  }
}

await browser.close();
console.log(`\n찍음 ${done.length}장 · 실패 ${failed.length}${failed.length ? " (" + failed.join(", ") + ")" : ""}`);
console.log("다음: 사람이 한 장씩 훑어보고(개인정보·빈 화면), catalog.ts 의 shot() 이름을 새 번호로 바꿉니다.");
