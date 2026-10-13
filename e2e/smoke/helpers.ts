import { expect, type Page } from "@playwright/test";
import { BASE_URL } from "./env";

//   운영에서 원래 나는 소리(외부 스크립트·분석 도구 등) — 화면이 깨진 게 아니라 실패로 치지 않는다
const BENIGN = [/ResizeObserver loop/i, /Non-Error promise rejection captured/i, /Loading chunk \d+ failed/i, /wcs\.naver|googletagmanager|clarity|sentry/i];

/** 화면을 열고, 첫 방문 동의창·안내 투어를 넘기고, 깨진 화면인지 판정할 재료를 모은다 */
export async function openPage(page: Page, path: string) {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => { if (!BENIGN.some((r) => r.test(e.message))) pageErrors.push(e.message.slice(0, 300)); });
  const resp = await page.goto(BASE_URL + path, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  // 첫 방문 약관 동의창
  const consent = page.locator(".consent-gate-check input[type=checkbox]");
  if (await consent.isVisible().catch(() => false)) {
    await consent.check();
    await page.getByRole("button", { name: "동의하고 계속하기" }).click();
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  }
  await page.keyboard.press("Escape").catch(() => {});   // 안내 투어·팝업
  await page.waitForTimeout(1200);
  return { status: resp?.status() ?? 0, pageErrors };
}

/** 깨진 화면이 아님을 확인 — 오류 화면·404·로그인 튕김·빈 화면·잡히지 않은 스크립트 오류 */
export async function expectHealthy(page: Page, path: string, info: { status: number; pageErrors: string[] }) {
  expect(info.status, `${path} HTTP 상태`).toBeLessThan(400);
  const url = new URL(page.url());
  expect(url.pathname.startsWith("/auth"), `${path} → 로그인 화면으로 튕김(세션·권한 문제)`).toBeFalsy();
  const body = (await page.locator("body").innerText().catch(() => "")) || "";
  expect(body.includes("오류가 발생했습니다"), `${path} 오류 화면(에러 바운더리)이 떴다`).toBeFalsy();
  expect(/This page could not be found|404\s*\|/.test(body), `${path} 404`).toBeFalsy();
  expect(body.replace(/\s+/g, "").length, `${path} 화면이 비어 있다`).toBeGreaterThan(40);
  expect(info.pageErrors, `${path} 잡히지 않은 스크립트 오류`).toEqual([]);
}

/** 오른쪽 아래 알림(토스트) 글자 — 성공·실패 문구 확인용 */
export async function toastText(page: Page, timeout = 20_000): Promise<string> {
  const t = page.locator(".toast-item").last();
  await t.waitFor({ state: "visible", timeout });
  return (await t.innerText()).trim();
}
