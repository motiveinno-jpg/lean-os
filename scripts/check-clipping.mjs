// 화면을 돌며 **글자가 칸보다 커서 잘리는 입력칸**을 찾아낸다 (2026-08-12)
//
//   왜 만들었나: 조회기간 연도 칸을 34px 로 줄였다가 '2026' 의 6 이 잘렸다.
//   나는 "34px 로 바뀌었다"만 확인했지 "그 34px 에 글자가 들어가는가"는 안 봤다.
//   요소 크기를 재는 것은 검증이 아니다 — 잘림(scrollWidth > clientWidth)을 봐야 한다.
//
//   실행:  node scripts/check-clipping.mjs            (기본 localhost:3111)
//          BASE=https://www.owner-view.com node scripts/check-clipping.mjs
//   로그인 정보는 환경변수로: OV_EMAIL, OV_PW
//
//   ⚠️ 입력칸(input)만 본다. 표 셀·긴 제목은 일부러 말줄임(…) 하는 자리라 잘려도 정상이다.

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3111";
const EMAIL = process.env.OV_EMAIL || "";
const PW = process.env.OV_PW || "";

//   날짜·숫자처럼 **고정폭 입력칸**이 있는 화면들. 새 화면을 만들면 여기 추가한다.
const PAGES = [
  "/collect",
  "/tax-invoices",
  "/e-invoices",
  "/cash-receipts",
  "/partners",
  "/partners/ledger",
  "/partners/reconciliation/voucher-entry",
  "/partners/reconciliation/sale-purchase",
  "/reports/pnl",
  "/signatures",
  "/bank",
  "/cards",
];

const SCAN = () => {
  const bad = [];
  for (const el of document.querySelectorAll("input")) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (el.type === "checkbox" || el.type === "radio") continue;
    const over = el.scrollWidth - el.clientWidth;
    if (over > 1) {
      bad.push({
        cls: String(el.className || "").split(" ").slice(0, 2).join(" "),
        value: el.value,
        inner: el.clientWidth,
        needs: el.scrollWidth,
      });
    }
  }
  return bad;
};

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  let failed = 0;

  if (EMAIL && PW) {
    await page.goto(`${BASE}/auth/`, { waitUntil: "domcontentloaded" });
    await page.fill("input[type=email]", EMAIL);
    await page.fill("input[type=password]", PW);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(4000);
  }

  for (const path of PAGES) {
    await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const bad = await page.evaluate(SCAN);
    if (bad.length) {
      failed += bad.length;
      console.log(`\n✗ ${path} — 잘린 입력칸 ${bad.length}개`);
      for (const b of bad) console.log(`    ${b.cls} "${b.value}" — 안쪽 ${b.inner}px 인데 ${b.needs}px 필요`);
    } else {
      console.log(`✓ ${path}`);
    }
  }

  await browser.close();
  if (failed) {
    console.log(`\n잘린 입력칸 ${failed}개 — 폭을 늘리세요.`);
    console.log("최소폭은 눈대중이 아니라 canvas.measureText() 로 글자 실폭을 재서 정합니다.");
    process.exit(1);
  }
  console.log("\n모든 화면 통과 — 잘린 입력칸 없음.");
};

run().catch((e) => { console.error(e); process.exit(1); });
