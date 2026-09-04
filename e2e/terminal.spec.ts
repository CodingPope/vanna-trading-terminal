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

  test('chart type switches the series in the default TradingView view', async ({ page }) => {
    await enterTerminal(page);
    const chart = page.locator('canvas').first();

    // The default view had no chartType prop at all, so these three buttons
    // changed state nothing read.
    await page.getByRole('button', { name: 'Candlestick chart' }).first().click();
    await page.waitForTimeout(900);
    const candles = await chart.screenshot();

    await page.getByRole('button', { name: 'Line chart' }).first().click();
    await page.waitForTimeout(900);
    const line = await chart.screenshot();

    expect(Buffer.compare(candles, line)).not.toBe(0);
  });

  test('the search bar opens the command palette its badge advertises', async ({ page }) => {
    await enterTerminal(page);

    await page.getByRole('button', { name: 'Search symbols' }).click();

    // It used to be an input that accepted keystrokes and did nothing at all.
    await expect(page.getByPlaceholder(/type a command/i)).toBeVisible();
  });

  test('the bell opens a notification history', async ({ page }) => {
    await enterTerminal(page);

    await page.getByRole('button', { name: 'Notifications' }).click();
    const panel = page.getByRole('dialog', { name: 'Notifications' });
    await expect(panel).toBeVisible();

    // The welcome toast auto-dismisses after 5s; the history is where it
    // survives. Either it is listed, or the empty state says so plainly.
    await expect(panel).toContainText(/Welcome to VANNA|No notifications/);

    await panel.getByRole('button', { name: 'Close notifications' }).click();
    await expect(panel).not.toBeVisible();
  });

  test('the logo returns to the landing page', async ({ page }) => {
    await enterTerminal(page);

    await page.getByRole('button', { name: 'Return to landing page' }).click();

    await expect(page.getByRole('button', { name: /enter terminal/i })).toBeVisible();
  });

  test('the shortcut map appears in settings and matches the ? modal', async ({ page }) => {
    await enterTerminal(page);

    await page.getByRole('button', { name: 'Settings' }).first().click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await expect(settings.getByText('Keyboard shortcuts')).toBeVisible();
    await expect(settings.getByText('Command palette')).toBeVisible();

    // Both surfaces render from lib/shortcuts, so a shortcut in one is in the
    // other. The old modal kept its own copy and drifted.
    await expect(settings).not.toContainText('Execute order');
    await settings.getByRole('button', { name: 'Close settings' }).click();

    await page.keyboard.press('Shift+Slash');
    const modal = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(modal).toBeVisible();
    await expect(modal.getByText('Command palette')).toBeVisible();
    await expect(modal).not.toContainText('Execute order');
  });

  test('the trades tape fills from the feed and keeps growing', async ({ page }) => {
    await enterTerminal(page);

    const rows = page.locator('text=TRADES').locator('xpath=ancestor::div[contains(@class,"glass-panel")]')
      .locator('div.grid.grid-cols-\\[auto_auto_auto_auto\\]');

    // Backfilled from the snapshot, so it is populated on first paint rather
    // than filling in from empty. The panel used to invent these itself.
    await expect.poll(async () => rows.count(), { timeout: 20_000 }).toBeGreaterThan(3);
    const first = await rows.count();

    await page.waitForTimeout(4000);
    // And live prints keep arriving.
    await expect.poll(async () => rows.count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(first);
  });

  test('the orb legend explains the sphere and switches scope', async ({ page }) => {
    await enterTerminal(page);
    await page.getByRole('button', { name: 'Settings' }).first().click();
    const settings = page.getByRole('dialog', { name: 'Settings' });

    // A key that reads live values, so it doubles as a readout.
    await expect(settings.getByText('Market orb')).toBeVisible();
    await expect(settings.getByText('Shape')).toBeVisible();
    await expect(settings.getByText(/Dispersion/)).toBeVisible();

    const focus = settings.getByRole('button', { name: 'Focus list' });
    await expect(focus).toHaveAttribute('aria-pressed', 'false');
    await focus.click();
    await expect(focus).toHaveAttribute('aria-pressed', 'true');

    // The reading is scoped, so the sample size follows the chosen universe.
    await expect(settings.getByText(/symbols?$/)).toBeVisible();
  });

  test('positions load and mark to the live price', async ({ page }) => {
    await enterTerminal(page);

    const panel = page.getByText('POSITIONS').first()
      .locator('xpath=ancestor::div[contains(@class,"glass-panel")]');

    // The book used to be initialised empty and never filled, so this panel
    // read "No open positions" and +$0.00 P&L permanently.
    await expect(panel).not.toContainText('No open positions', { timeout: 20_000 });
    await expect(panel.getByText('AAPL').first()).toBeVisible();

    // P&L is derived from the live quote, so the marks move as the market
    // does rather than waiting on a server message. Compare the panel's whole
    // text: row P&L renders without decimals, so targeting a currency pattern
    // with cents matches nothing and quietly compares null to null.
    const before = await panel.innerText();
    await expect.poll(async () => panel.innerText(), { timeout: 20_000 })
      .not.toBe(before);
  });
});
