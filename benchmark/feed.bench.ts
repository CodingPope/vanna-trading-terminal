import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

/**
 * A repeatable measurement of the feed under load.
 *
 * The scenario is fixed on purpose — same viewport, same speed, same warmup,
 * same window, same interactions — because a benchmark that varies with the
 * operator measures the operator. It runs twice and reports both runs, so a
 * reader can see whether the numbers are stable enough to regress against
 * before trusting either of them.
 *
 * Method and definitions: docs/PERFORMANCE.md.
 */

const require = createRequire(import.meta.url);
const thresholds = require('./thresholds.json') as Record<string, Record<string, number | string>>;

/**
 * The scenario is fixed by default. The overrides exist for deliberate
 * experiments — comparing speeds, say — and every artifact records the values
 * it actually ran with, so an experimental run cannot be mistaken for the
 * reference one.
 */
const number = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

/** Discarded: first paint, chart init, and JIT warmup are not steady state. */
const WARMUP_MS = number('BENCH_WARMUP_MS', 5_000);
/** The measurement window, at the speed below. */
const WINDOW_MS = number('BENCH_WINDOW_MS', 30_000);
/**
 * 5x, not max. "Max" drains the server's whole per-turn budget, which walks a
 * synthetic session through its hour of event time in under two seconds — the
 * window would then measure a session that had already ended. 5x sustains the
 * stream for the whole window, which is the thing worth measuring.
 */
const SPEED = process.env.BENCH_SPEED ?? '5';
const RUNS = number('BENCH_RUNS', 2);

interface Measurements {
  [metric: string]: unknown;
}

function commit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function dirty(): boolean {
  try {
    return execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
  } catch {
    return true;
  }
}

/** Reads a dotted path such as "frameDelayMs.p99" out of the artifact. */
function read(measurements: Measurements, dotted: string): number | null {
  const value = dotted.split('.').reduce<unknown>(
    (node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined),
    measurements);
  return typeof value === 'number' ? value : null;
}

/**
 * Captures the artifact the Export button produces, rather than reaching into
 * the app: the benchmark then measures the shipped export path, and needs no
 * hook that exists only for tests.
 */
async function captureExports(page: Page) {
  await page.addInitScript(() => {
    const target = window as unknown as { __vannaExport?: string };
    const anchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      if (this.download) return;   // No download dialog during a measurement.
      anchorClick.call(this);
    };
    const createObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob: Blob) => {
      void blob.text().then(text => { target.__vannaExport = text; });
      return createObjectURL(blob);
    };
  });
}

async function measureOnce(page: Page, run: number) {
  // A full load each run. Navigating to the same URL only changes the hash,
  // which would leave the previous run's state — and its export — in place.
  await page.goto('about:blank');
  await page.goto('/#terminal');
  await expect(page.getByTestId('feed-status')).toHaveText(/CONNECTED|PAUSED/, { timeout: 30_000 });
  const readout = page.getByRole('region', { name: 'Feed measurements' });

  await page.getByLabel('Playback speed').selectOption(SPEED);
  await page.waitForTimeout(WARMUP_MS);

  // Warmup discarded here, so the window below starts from an empty sample.
  await readout.getByRole('button', { name: 'Reset measurements' }).click();

  // A fixed interaction script: the panels a reviewer actually touches.
  const started = Date.now();
  for (const symbol of ['NVDA', 'TSLA', 'AAPL']) {
    await page.waitForTimeout(WINDOW_MS / 6);
    await page.getByRole('button', { name: new RegExp(`^${symbol}`) }).first().click({ trial: false })
      .catch(() => { /* A symbol not on screen is not a measurement failure. */ });
    await page.waitForTimeout(WINDOW_MS / 6);
  }
  await page.waitForTimeout(Math.max(0, WINDOW_MS - (Date.now() - started)));

  await page.evaluate(() => { delete (window as unknown as { __vannaExport?: string }).__vannaExport; });
  await readout.getByRole('button', { name: 'Export' }).click();
  const exported = await page.waitForFunction(
    () => (window as unknown as { __vannaExport?: string }).__vannaExport ?? null);
  const artifact = JSON.parse(await exported.jsonValue() as string) as {
    measurements: Measurements; replay: Record<string, unknown> | null; method: Record<string, unknown>;
  };

  const memory = await page.evaluate(() => {
    const performanceMemory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return performanceMemory ? Math.round(performanceMemory.usedJSHeapSize / 1024 / 1024) : null;
  });

  return { run, windowMs: WINDOW_MS, warmupMs: WARMUP_MS, speed: SPEED, heapMb: memory, ...artifact };
}

test('feed benchmark', async ({ page, browser }) => {
  await captureExports(page);
  const runs = [];
  for (let run = 1; run <= RUNS; run++) runs.push(await measureOnce(page, run));

  const checks: { metric: string; value: number | null; limit: number; kind: string; pass: boolean }[] = [];
  for (const [metric, rule] of Object.entries(thresholds)) {
    if (metric === 'note' || metric === 'runToRunTolerance') continue;
    const limits = rule as { max?: number; min?: number };
    for (const measured of runs) {
      const value = read(measured.measurements, metric);
      if (limits.max !== undefined) {
        checks.push({ metric, value, limit: limits.max, kind: 'max', pass: value !== null && value <= limits.max });
      }
      if (limits.min !== undefined) {
        checks.push({ metric, value, limit: limits.min, kind: 'min', pass: value !== null && value >= limits.min });
      }
    }
  }

  const tolerance = thresholds.runToRunTolerance as Record<string, { maxRatio?: number }>;
  const stability: { metric: string; values: (number | null)[]; ratio: number | null; limit: number; pass: boolean }[] = [];
  for (const [metric, rule] of Object.entries(tolerance)) {
    if (metric === 'note' || rule.maxRatio === undefined) continue;
    const values = runs.map(measured => read(measured.measurements, metric));
    const usable = values.filter((value): value is number => typeof value === 'number' && value > 0);
    const ratio = usable.length === runs.length ? Math.max(...usable) / Math.min(...usable) : null;
    stability.push({ metric, values, ratio, limit: rule.maxRatio, pass: ratio !== null && ratio <= rule.maxRatio });
  }

  const artifact = {
    schema: 'vanna-benchmark-v1',
    takenAt: new Date().toISOString(),
    commit: commit(),
    workingTreeDirty: dirty(),
    environment: {
      browser: `${browser.browserType().name()} ${browser.version()}`,
      platform: `${os.type()} ${os.release()} ${os.arch()}`,
      cpu: os.cpus()[0]?.model ?? 'unknown',
      cores: os.cpus().length,
      totalMemoryGb: Math.round(os.totalmem() / 1024 ** 3),
      node: process.version,
      buildMode: 'production build behind vite preview',
    },
    scenario: { warmupMs: WARMUP_MS, windowMs: WINDOW_MS, speed: SPEED, runs: RUNS,
                viewport: '1366x900', interactions: 'symbol rotation NVDA, TSLA, AAPL' },
    method: runs[0].method,
    fixture: runs[0].replay,
    runs,
    checks,
    stability,
    pass: checks.every(check => check.pass) && stability.every(check => check.pass),
  };

  const directory = path.join('benchmark', 'results');
  mkdirSync(directory, { recursive: true });
  const name = process.env.BENCH_OUT ?? 'latest';
  writeFileSync(path.join(directory, `${name}.json`), `${JSON.stringify(artifact, null, 2)}\n`);

  const failed = [...checks.filter(c => !c.pass), ...stability.filter(c => !c.pass)];
  expect(failed, `thresholds failed:\n${JSON.stringify(failed, null, 2)}`).toEqual([]);
});
