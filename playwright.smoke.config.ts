import { defineConfig, devices } from "@playwright/test";

// 배포 후 자동 점검(.github/workflows/post-deploy-smoke.yml). 로컬: SUPABASE_ACCESS_TOKEN=… npx playwright test -c playwright.smoke.config.ts
export default defineConfig({
  testDir: "./e2e/smoke",
  globalSetup: "./e2e/smoke/global-setup.ts",
  fullyParallel: false,
  workers: 2,
  retries: 1,              // 한 번은 네트워크·콜드스타트 흔들림으로 칠 수 있다 — 두 번 연속 실패만 실패
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "smoke-report" }], ["./e2e/smoke/report-to-db.ts"]],
  use: {
    baseURL: process.env.SMOKE_BASE_URL || "https://www.owner-view.com",
    storageState: "e2e/smoke/.auth-state.json",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    navigationTimeout: 45_000,
    actionTimeout: 15_000,
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
  },
});
