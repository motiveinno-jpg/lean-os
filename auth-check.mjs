import { chromium } from "playwright";
const BASE = "https://www.owner-view.com";
const PW = process.env.OV_PASSWORD || "";
const email = (process.env.OV_EMAIL || "").trim();

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
try {
  console.log(`email="${email}" (len ${email.length}), pw len ${PW.length}`);
  await page.goto(BASE + "/auth", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PW);
  // 값 확인(비번은 길이만)
  const ev = await page.locator('input[type="email"]').inputValue();
  const pv = await page.locator('input[type="password"]').inputValue();
  console.log(`filled email="${ev}", pw len ${pv.length}`);
  const submit = page.locator('form.auth-form button[type="submit"]');
  if (await submit.count()) { console.log("submit 버튼 클릭"); await submit.click(); }
  else { console.log("Enter 제출"); await page.locator('input[type="password"]').press("Enter"); }
  await page.waitForTimeout(7000);
  const url = page.url();
  const err = await page.locator('[role="alert"], .auth-error-banner').first().textContent().catch(() => "");
  console.log(`결과 URL: ${url}`);
  console.log(`결과: ${/\/auth/.test(url) ? "로그인 실패" : "로그인 성공"}  ${err ? "메시지=" + err.trim() : ""}`);
  await page.screenshot({ path: "C:/Users/연준호/AppData/Local/Temp/claude/C--Users-----Desktop-motive-lean-os/19f91921-78b1-40e1-92a6-4d4ecab8a875/scratchpad/login-result.png" });
} catch (e) {
  console.log("오류:", e.message.split("\n")[0]);
} finally {
  await ctx.close();
  await browser.close();
}
