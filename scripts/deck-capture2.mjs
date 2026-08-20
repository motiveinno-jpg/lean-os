#!/usr/bin/env node
// 2차 캡처 — 화면 전체(뷰포트)를 2배로 찍어 두고, 필요한 조각은 파이썬에서 정확히 잘라 쓴다.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const BASE = "http://localhost:3111";
mkdirSync("cap", { recursive: true });
const HIDE = `nextjs-portal,[data-nextjs-dev-overlay],#channel-plugin-launcher,iframe#ch-plugin-script,div[id^="ch-plugin"]{display:none!important}`;
const b = await chromium.launch({ headless: true });
const c = await b.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, locale: "ko-KR", timezoneId: "Asia/Seoul" });
const p = await c.newPage();
await p.goto(`${BASE}/auth`); await p.fill('input[type=email]', "demo-ov-owner@mo-tive.com");
await p.fill('input[type=password]', "OvDemo!2026"); await p.click('button[type=submit]');
await p.waitForTimeout(7000);
const shots = [
  ["v-bank", "/bank"], ["v-cards", "/cards"], ["v-collect", "/collect"],
  ["v-tax", "/tax-invoices"], ["v-flow", "/reports/flow"], ["v-ledger", "/partners/ledger"],
  ["v-sign", "/signatures"], ["v-appr", "/approvals"], ["v-emp", "/employees"],
  ["v-att", "/attendance"], ["v-sched", "/schedule"], ["v-billing", "/billing"],
  ["v-projects", "/projecthub"], ["v-profit", "/reports/profit"], ["v-vat", "/reports/vat"],
  ["v-sale-purchase", "/partners/reconciliation/sale-purchase"],
];
for (const [name, path] of shots) {
  await p.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(5000);
  await p.addStyleTag({ content: HIDE }).catch(() => {});
  await p.keyboard.press("Escape").catch(() => {});
  await p.screenshot({ path: `cap/${name}.png` });
  console.log("📸", name);
}
// 프로젝트 보드 탭 뷰포트
const deal = "9dc55d4f-4724-45c1-8b72-36be8d4954ef";
await p.goto(`${BASE}/projecthub/${deal}`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(6000);
await p.addStyleTag({ content: HIDE }).catch(() => {});
for (const [name, re] of [["v-pb-meeting", /회의/], ["v-pb-todo", /할 일/], ["v-pb-revenue", /매출/], ["v-pb-contract", /계약/], ["v-pb-spend", /예산/]]) {
  await p.getByRole("button", { name: re }).first().click({ timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(4000);
  await p.screenshot({ path: `cap/${name}.png` });
  console.log("📸", name);
}
await b.close();
console.log("done");
