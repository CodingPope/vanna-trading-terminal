import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
const python = process.env.VANNA_PYTHON ?? (existsSync('server/.venv/bin/python') ? 'server/.venv/bin/python' : 'python3');
export default defineConfig({
  testDir: './e2e', timeout: 60_000, expect: { timeout: 15_000 },
  fullyParallel: false, workers: 1, reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure',
    viewport: { width: 1366, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: `${python} -m uvicorn app.main:app --app-dir server --host 127.0.0.1 --port 8010`,
      url: 'http://127.0.0.1:8010/api/health', reuseExistingServer: false, timeout: 30000 },
    { command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173',
      env: { VANNA_API_TARGET: 'http://127.0.0.1:8010' },
      url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 120000 },
  ],
});
