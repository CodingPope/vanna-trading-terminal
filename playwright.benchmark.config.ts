import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
const python = process.env.VANNA_PYTHON ?? (existsSync('server/.venv/bin/python') ? 'server/.venv/bin/python' : 'python3');
/**
 * The benchmark runs against the same stack as the e2e suite, deliberately:
 * a production build behind the preview server and the real FastAPI service.
 * A dev server with HMR attached measures the dev server. See docs/PERFORMANCE.md.
 */
export default defineConfig({
  testDir: './benchmark', testMatch: '**/*.bench.ts', timeout: 300_000, expect: { timeout: 30_000 },
  fullyParallel: false, workers: 1, retries: 0, reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    // Fixed, so two runs measure the same amount of screen.
    viewport: { width: 1366, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    // The baseline and thresholds were measured against the synthetic engine.
    // server/app/main.py auto-loads a local .env, so a developer with
    // VANNA_FIXTURE pointed at a real recorded fixture would otherwise get a
    // benchmark run of a completely different (real, event-driven) source
    // silently compared against synthetic-sourced thresholds.
    { command: `${python} -m uvicorn app.main:app --app-dir server --host 127.0.0.1 --port 8010`,
      env: { VANNA_DATA_MODE: 'synthetic', VANNA_FIXTURE: '' },
      url: 'http://127.0.0.1:8010/api/health', reuseExistingServer: false, timeout: 30000 },
    { command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173',
      env: { VANNA_API_TARGET: 'http://127.0.0.1:8010' },
      url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 120000 },
  ],
});
