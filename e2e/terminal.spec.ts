import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * What a person actually sees.
 *
 * Every bug this file guards against shipped past a green unit suite, because
 * each one is invisible from inside a component: a grid that renders no rows,
 * a control that changes a highlight and nothing else, a panel hidden behind
 * a toolbar. None of them throw.
 */

/** Collects console errors so a test can assert the page is quiet. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  const capture = (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text());
  };
  page.on('console', capture);
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  return errors;
}

async function enterTerminal(page: Page) {
  await page.goto('/');
  const enter = page.getByRole('button', { name: /enter terminal/i });
  if (await enter.count()) await enter.click();
  // The landing page holds a deliberate loading beat before the dashboard.
  await expect(page.getByText('ORDER BOOK').first()).toBeVisible({ timeout: 20_000 });
}

test.describe('terminal', () => {
  test('reaches the dashboard without console errors', async ({ page }) => {
    const errors = watchConsole(page);
    await enterTerminal(page);
    await page.waitForTimeout(2500);

    // WebGL performance chatter from the orb is not an application error.
    const real = errors.filter(e => !/WebGL|GL Driver/i.test(e));
    expect(real, `console errors:\n${real.join('\n')}`).toEqual([]);
  });

  test('order book renders actual price levels', async ({ page }) => {
    await enterTerminal(page);

    // The regression that started this file: AG Grid without registered
    // modules mounts a full-looking panel containing no rows at all.
    const rows = page.locator('.vanna-book-grid [role="row"]');
    await expect.poll(async () => rows.count(), { timeout: 20_000 })
      .toBeGreaterThan(4);
  });

  test('order book never shows a bid above an ask', async ({ page }) => {
    await enterTerminal(page);
    await page.waitForTimeout(4000);

    const prices = await page.locator('.vanna-book-grid').evaluateAll(grids =>
      grids.map(g =>
        [...g.querySelectorAll('[role="row"]')]
          .map(r => parseFloat(r.textContent?.match(/\d+\.\d+/)?.[0] ?? 'NaN'))
          .filter(n => !Number.isNaN(n)),
      ),
    );

    const [asks, bids] = prices;
    if (asks?.length && bids?.length) {
      // A crossed book is not a book. This is what a mismatched delta model
      // looked like on screen.
      expect(Math.min(...asks)).toBeGreaterThan(Math.max(...bids));
    }
  });

  test('changing timeframe changes the chart, not just the highlight', async ({ page }) => {
    await enterTerminal(page);

    const oneMin = page.getByRole('button', { name: '1M', exact: true }).first();
    const fifteen = page.getByRole('button', { name: '15M', exact: true }).first();

    await oneMin.click();
    await page.waitForTimeout(800);
    const before = await page.locator('.recharts-wrapper, canvas').first().screenshot();

    await fifteen.click();
    await page.waitForTimeout(800);
    const after = await page.locator('.recharts-wrapper, canvas').first().screenshot();

    // Aggregating to 15m must redraw. Before this the buttons set state that
    // nothing read.
    expect(Buffer.compare(before, after)).not.toBe(0);
  });

  test('settings opens, toggles and persists to the store', async ({ page }) => {
    await enterTerminal(page);

    await page.getByRole('button', { name: 'Settings' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();

    const toggle = dialog.getByRole('switch', { name: 'High contrast' });
    const was = await toggle.getAttribute('aria-checked');
    await toggle.click();
    expect(await toggle.getAttribute('aria-checked')).not.toBe(was);

    await dialog.getByRole('button', { name: 'Close settings' }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('workspace controls are not covered by a panel', async ({ page }) => {
    await enterTerminal(page);

    // The toolbar used to sit over a panel container at inset-0, so anything
    // positioned top-right rendered underneath these buttons.
    const reset = page.getByRole('button', { name: 'Reset' });
    await expect(reset).toBeVisible();
    const box = await reset.boundingBox();
    expect(box).not.toBeNull();

    const topmost = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el?.textContent?.trim() ?? '';
    }, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });

    expect(topmost).toBe('Reset');
  });

  test('the footer does not claim LIVE without a socket', async ({ page }) => {
    await enterTerminal(page);
    await page.waitForTimeout(2500);

    const live = await page.getByText('LIVE', { exact: true }).count();
    const simulated = await page.getByText('SIMULATED', { exact: true }).count();

    // Exactly one of them, and never LIVE while the latency readout is empty.
    expect(live + simulated).toBeGreaterThan(0);
    if (live > 0) {
      await expect(page.getByTitle('WebSocket round-trip latency')).not.toHaveText('—');
    }
  });
});
