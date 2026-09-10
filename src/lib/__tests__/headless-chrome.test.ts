import { expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ launch: vi.fn(), path: vi.fn() }));
vi.mock("@sparticuz/chromium", () => ({ default: { args: [], executablePath: m.path } }));
vi.mock("puppeteer-core", () => ({ default: { launch: m.launch } }));
it("동시 PDF 요청은 공용 브라우저를 한 번만 기동한다", async () => {
  vi.resetModules();
  const browser = { connected: true };
  m.path.mockResolvedValue("/test-only/chrome");
  m.launch.mockResolvedValue(browser);
  const { getPdfBrowser } = await import("@/lib/headless-chrome");
  const results = await Promise.all([getPdfBrowser(), getPdfBrowser(), getPdfBrowser()]);
  expect(m.launch).toHaveBeenCalledOnce();
  expect(results).toEqual([browser, browser, browser]);
  expect(await getPdfBrowser()).toBe(browser);
  expect(m.launch).toHaveBeenCalledOnce();
});
