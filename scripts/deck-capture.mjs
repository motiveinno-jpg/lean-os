#!/usr/bin/env node
/**
 * OwnerView — 소개서(PPT) 캡처 수집기 (2026-08-20 사장님 지시)
 *
 *   사장님: "각 설명에 맞는 이미지(일부)만 캡처해서 직관성을 높이자" · "이미지는 무조건 고화질".
 *   → 페이지 전체가 아니라 **설명 항목 = 캡처 조각 1개**. 모두 deviceScaleFactor 2(=2배 해상도).
 *   → 데이터는 **시연 회사 '오너뷰'**(demo-ov-owner@mo-tive.com) 만 쓴다. 실회사 정보 노출 0.
 *
 * 실행: node scripts/deck-capture.mjs   (dev 서버 localhost:3111 이 떠 있어야 함)
 * 결과: cap/*.png  (git 무시)
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.OV_BASE || "http://localhost:3111";
const EMAIL = "demo-ov-owner@mo-tive.com";
const PASSWORD = "OvDemo!2026";
const OUT = "cap";
mkdirSync(OUT, { recursive: true });

/** 개발 오버레이·채널톡처럼 제품과 무관한 것은 감춘다 */
const HIDE_CSS = `
  nextjs-portal, [data-nextjs-dev-overlay], #channel-plugin-launcher,
  iframe#ch-plugin-script, div[id^="ch-plugin"], [class*="ch-desk-messenger"] { display: none !important; }
`;

const log = (...a) => console.log(...a);

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,                       // ← 고화질(2배)
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss().catch(() => {}));

  // ── 로그인 ──
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(/dashboard/, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  // 약관 동의 · 온보딩 마법사가 뜨면 넘긴다
  const agree = page.locator('input[type=checkbox]').first();
  if (await agree.isVisible().catch(() => false)) {
    await agree.click().catch(() => {});
    await page.getByRole("button", { name: /동의하고 계속하기/ }).click().catch(() => {});
    await page.waitForTimeout(1500);
  }
  //   초기 설정 마법사·앱 투어가 뜨면 화면이 딤 처리돼 캡처가 어두워진다 — 저장 키로 미리 끈다
  await page.evaluate(() => {
    localStorage.setItem("leanos-onboarding-done", "true");
    localStorage.setItem("ov-app-tour-dismissed-at", String(Date.now()));
    localStorage.removeItem("ov-app-tour-step");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.keyboard.press("Escape").catch(() => {});
  await page.getByText("이 안내 다시 보지 않기").click({ timeout: 2000 }).catch(() => {});
  await page.getByRole("button", { name: "닫기" }).first().click({ timeout: 2000 }).catch(() => {});
  await page.addStyleTag({ content: HIDE_CSS });
  log("✅ 로그인 완료");

  const go = async (path, wait = 3000) => {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(wait);
    await page.addStyleTag({ content: HIDE_CSS }).catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
  };

  /** 요소 조각 캡처 — 없으면 건너뛰고 이유를 남긴다(캡처 목록과 실제 화면이 어긋난 걸 알아야 한다) */
  const shot = async (name, selector, opts = {}) => {
    const path = `${OUT}/${name}.png`;
    try {
      if (!selector) { await page.screenshot({ path, fullPage: !!opts.full }); log("  📸", name, "(전체)"); return true; }
      const el = page.locator(selector).first();
      await el.waitFor({ state: "visible", timeout: opts.timeout ?? 6000 });
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(opts.settle ?? 500);
      await el.screenshot({ path });
      log("  📸", name);
      return true;
    } catch (e) {
      log("  ⚠️ ", name, "— 못 찍음:", String(e.message).split("\n")[0].slice(0, 80));
      return false;
    }
  };
  /** 좌표 잘라내기 — 요소 선택자가 마땅치 않을 때 */
  const clip = async (name, clipBox) => {
    await page.screenshot({ path: `${OUT}/${name}.png`, clip: clipBox });
    log("  📸", name, "(clip)");
  };

  // ══ 01 대시보드 ══
  log("▶ 대시보드");
  await go("/dashboard", 5000);
  await shot("01-dashboard-full", null);                       // 표지 히어로(유일한 전체 뷰)
  await shot("02-signals", ".dash-signals, [class*='dash-sig']");
  await shot("03-briefing", ".brief, [class*='morning-brief'], [class*='brief-']");
  await shot("04-widget-receivables", "[class*='receivable']");
  await shot("05-widget-tax", "[class*='tax-schedule'], [class*='dash-tax']");

  // ══ 통장 ══
  log("▶ 통장");
  await go("/bank", 4500);
  await shot("10-bank-accounts", "[class*='acct'], [class*='bank-card']");
  await shot("11-bank-table", ".ev-table, table");

  // ══ 카드 ══
  log("▶ 카드");
  await go("/cards", 4000);
  await shot("12-cards", "[class*='card-list'], .ev-table, table");

  // ══ 수집·전표 ══
  log("▶ 수집 · 전표");
  await go("/collect", 4500);
  await shot("13-collect", ".collect-tabs, [class*='collect']");
  await go("/partners/reconciliation/sale-purchase", 6000);
  await shot("14-vouchers", ".ev-table, table", { timeout: 12000 });
  await go("/partners/reconciliation/voucher-entry", 6000);
  await shot("14b-voucher-entry", ".ev-table, table, form", { timeout: 12000 });

  // ══ 세금계산서 ══
  log("▶ 세금계산서");
  await go("/tax-invoices", 4500);
  await shot("15-tax-invoices", ".ev-table, table");

  // ══ 경영흐름 ══
  log("▶ 경영흐름");
  await go("/reports/flow", 5000);
  await shot("16-flow", "[class*='viz'], svg, canvas");
  await shot("16b-flow-panel", "[class*='panel'], .glass-card");

  // ══ 거래처 원장 ══
  log("▶ 거래처 원장");
  await go("/partners/ledger", 5000);
  await shot("17-ledger", ".ledger-body, [class*='ledger']");

  // ══ 프로젝트 ══
  log("▶ 프로젝트");
  await go("/projecthub", 6000);
  await shot("18-projects", ".ev-table, table, [class*='pj-'], main", { timeout: 12000 });

  // ══ 프로젝트 보드 — 15번 장표의 네 조각(항목별 캡처) ══
  //   목록은 링크가 아니라 클릭 이동이라 주소를 직접 받는다(시연 프로젝트 id는 env 로 넘긴다)
  log("▶ 프로젝트 보드");
  {
    const dealId = process.env.OV_DEMO_DEAL || "9dc55d4f-4724-45c1-8b72-36be8d4954ef";
    await go(`/projecthub/${dealId}`, 6500);
    const tab = async (re, wait = 3500) => {
      await page.getByRole("button", { name: re }).first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(wait);
    };
    await tab(/회의/);
    await shot("30-meeting-agenda", ".pbm-item", { timeout: 10000 });
    await tab(/매출/);
    await shot("31-deal-card", ".pbd-card", { timeout: 10000 });
    await tab(/계약/);
    await shot("32-expiry-card", ".pbx-card", { timeout: 10000 });
    await shot("32b-expiry-grid", ".pbx", { timeout: 8000 });
    await tab(/예산/);
    await shot("33-expense", ".pbe", { timeout: 10000 });
    await tab(/할 일/);
    await shot("35-todo-board", ".pb-kan, .ev-table, table", { timeout: 10000 });
    await page.getByRole("button", { name: /템플릿/ }).first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await shot("34-templates", ".pb-tpls", { timeout: 10000 });
    await page.keyboard.press("Escape").catch(() => {});
  }

  // ══ 전자계약 ══
  log("▶ 전자계약");
  await go("/signatures", 6000);
  await shot("19-signatures", ".ev-table, table, [class*='sig'], main", { timeout: 12000 });

  // ══ 결재 허브 ══
  log("▶ 결재");
  await go("/approvals", 6000);
  await shot("20-approvals", ".ev-table, table, [class*='appr'], main", { timeout: 12000 });

  // ══ 인사 ══
  log("▶ 인사");
  await go("/employees", 4500);
  await shot("21-employees", ".ev-table, table");
  await go("/attendance", 4000);
  await shot("22-attendance", ".ev-table, table, [class*='att']");

  // ══ 일정 ══
  log("▶ 일정");
  await go("/schedule", 4000);
  await shot("23-schedule", "[class*='cal'], .ev-table, table");

  // ══ 요금제 ══
  log("▶ 요금제");
  await go("/billing", 4000);
  await shot("24-billing", ".billing-matrix, table");

  await browser.close();
  log("\n완료 — cap/ 확인");
}

main().catch((e) => { console.error(e); process.exit(1); });
