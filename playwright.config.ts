import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'https://www.owner-view.com',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    navigationTimeout: 30_000,
    actionTimeout: 15_000,
    ...devices['Desktop Chrome'],
  },
});
