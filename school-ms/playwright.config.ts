import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against the running local stack (scripts/local-stack/start.sh) with the
 * local demo seed (scripts/local-stack/seed-demo.mjs). Runs every test on a desktop and a
 * mobile viewport.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
