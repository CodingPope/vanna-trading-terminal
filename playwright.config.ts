import { defineConfig, devices } from '@playwright/test';

/**
 * Browser-level checks.
 *
 * These exist because a run of unit tests, a type check and a lint pass all
 * stayed green while the order book rendered as an empty shell: AG Grid v33+
 * needs its modules registered, and without that the grid mounts, logs an
 * error and draws nothing. Nothing throws. Nothing fails. The panel is simply
 * blank, and only a browser can tell you that.
 *
 * Kept out of `src/` so vitest does not pick them up — run with `yarn e2e`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1600, height: 950 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'yarn dev --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
