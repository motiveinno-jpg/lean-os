import { chromium } from "playwright";
const BASE = "https://www.owner-view.com";
const STATE = "C:/Users/연준호/AppData/Local/Temp/claude/C--Users-----Desktop-motive-lean-os/19f91921-78b1-40e1-92a6-4d4ecab8a875/scratchpad/auth-state.json";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, storageState: STATE, colorScheme: "light" });
const page = await ctx.newPage();
try {
  await page.goto(BASE + "/projecthub", { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  // "전체" 스코프 탭 클릭(내 담당 → 전체)
  await page.getByText("전체", { exact: true }).first().click({ timeout: 5000 }).catch((e) => console.log("전체 클릭 실패:", e.message.split("\n")[0]));
  await page.waitForTimeout(2500);
  const company = await page.locator("aside").getByText(/㈜|주식회사|\(주\)|회사/).first().textContent().catch(() => "");
  const openBtns = await page.locator(".ph-open-btn").count().catch(() => 0);
  // 카드 제목/유형 수집
  const cardTexts = await page.locator(".ph-open-btn").evaluateAll((btns) =>
    btns.map((b) => {
      const card = b.closest("[class*='card'],[class*='ph-']") || b.parentElement;
      return (card?.innerText || "").replace(/\s+/g, " ").slice(0, 120);
    })
  ).catch(() => []);
  console.log("URL:", page.url());
  console.log("사이드바 회사표기:", (company || "").trim());
  console.log("열기 버튼(.ph-open-btn) 개수:", openBtns);
  console.log("카드 미리보기:");
  cardTexts.forEach((t, i) => console.log(`  [${i}] ${t}`));
  // 목표형 존재 여부
  const hasGoal = cardTexts.some((t) => t.includes("목표형") || t.includes("🎯"));
  console.log("목표형 카드 존재:", hasGoal);
  await page.screenshot({ path: "C:/Users/연준호/AppData/Local/Temp/claude/C--Users-----Desktop-motive-lean-os/19f91921-78b1-40e1-92a6-4d4ecab8a875/scratchpad/projecthub.png", fullPage: false });
} catch (e) {
  console.log("오류:", e.message.split("\n")[0]);
} finally {
  await ctx.close();
  await browser.close();
}
