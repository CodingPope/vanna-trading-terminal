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
    // The suite assumes the full synthetic 20-symbol universe -- server/app/main.py
    // auto-loads a local .env, so a developer with VANNA_FIXTURE pointed at a real
    // recorded fixture for manual testing would otherwise have it silently pulled
    // into this run too. This override wins regardless of what .env says.
    { command: `${python} -m uvicorn app.main:app --app-dir server --host 127.0.0.1 --port 8010`,
      env: { VANNA_DATA_MODE: 'synthetic', VANNA_FIXTURE: '' },
      url: 'http://127.0.0.1:8010/api/health', reuseExistingServer: false, timeout: 30000 },
    { command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173',
      env: { VANNA_API_TARGET: 'http://127.0.0.1:8010' },
      url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 120000 },
  ],
});
