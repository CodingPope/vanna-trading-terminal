import { test, expect, type Page } from '@playwright/test';

async function enter(page: Page) {
  await page.goto('/#terminal');
  await expect(page.getByTestId('feed-status')).toHaveText('CONNECTED');
  await expect(page.getByRole('button', { name: 'Submit paper order' })).toBeEnabled();
}
const orders = (page: Page) => page.getByRole('table', { name: 'Paper orders' });

test('paper order → partial fill → cancel remainder → position → reconnect reconciliation', async ({ page }) => {
  await enter(page);
  await page.getByRole('combobox', { name: 'Order type' }).selectOption('market');
  await page.getByRole('spinbutton', { name: 'Quantity' }).fill('150');
  await page.getByRole('button', { name: 'Submit paper order' }).click();
  await expect(orders(page)).toContainText('partially filled');
  await orders(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(orders(page)).toContainText('canceled');
  const before = await orders(page).innerText();
  await expect(page.getByRole('table', { name: 'Paper positions' })).toContainText('AAPL');
  await page.getByRole('button', { name: 'Disconnect feed' }).click();
  await expect(page.getByTestId('feed-status')).toHaveText('DISCONNECTED');
  await expect(page.getByRole('button', { name: 'Submit paper order' })).toBeDisabled();
  await expect(page.getByTestId('feed-status')).toHaveText('CONNECTED');
  expect(await orders(page).innerText()).toBe(before);
  await page.reload();
  await expect(orders(page)).toContainText('canceled');
  await expect(page.getByRole('table', { name: 'Paper positions' })).toContainText('AAPL');
});

test('working limit order can be amended and canceled', async ({ page }) => {
  await enter(page);
  await page.getByRole('spinbutton', { name: 'Limit price' }).fill('1.00');
  await page.getByRole('button', { name: 'Submit paper order' }).click();
  await expect(orders(page)).toContainText('working');
  await orders(page).getByRole('button', { name: 'Amend' }).click();
  await page.getByRole('spinbutton', { name: 'Amend total quantity' }).fill('50');
  await page.getByRole('spinbutton', { name: 'Amend limit price' }).fill('2.00');
  await page.getByRole('button', { name: 'Save amendment' }).click();
  await expect(orders(page)).toContainText('50 / 0');
  await expect(orders(page)).toContainText('2.00');
  await orders(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(orders(page)).toContainText('canceled');
});

test('stale feed disables new orders and recovers without a reload', async ({ page }) => {
  await enter(page);
  await page.getByRole('button', { name: 'Stall feed 6s' }).click();
  await expect(page.getByTestId('feed-status')).toHaveText('STALE');
  await expect(page.getByRole('button', { name: 'Submit paper order' })).toBeDisabled();
  await expect(page.getByTestId('feed-status')).toHaveText('CONNECTED');
  await expect(page.getByRole('button', { name: 'Submit paper order' })).toBeEnabled();
});

test('sequence gaps recover, invalid payloads are rejected, and bursts are measured', async ({ page }) => {
  await enter(page);
  await page.getByRole('button', { name: 'Skip book sequence' }).click();
  await expect.poll(async () => Number(await page.locator('[data-metric="gaps"]').innerText())).toBeGreaterThan(0);
  await expect(page.getByTestId('feed-status')).toHaveText('CONNECTED');
  await page.getByRole('button', { name: 'Invalid payload' }).click();
  await expect.poll(async () => Number(await page.locator('[data-metric="invalid"]').innerText())).toBe(1);
  await page.getByRole('button', { name: 'Burst 1,000 quotes' }).click();
  await expect.poll(async () => Number(await page.locator('[data-metric="dropped"]').innerText())).toBeGreaterThan(0);
  await expect(page.getByTestId('feed-status')).toHaveText('CONNECTED');
});

test('two browser accounts cannot see each other’s paper orders', async ({ browser }) => {
  const a = await browser.newContext(), b = await browser.newContext();
  try {
    const one = await a.newPage(), two = await b.newPage();
    await enter(one); await enter(two);
    await one.getByRole('spinbutton', { name: 'Limit price' }).fill('1');
    await one.getByRole('button', { name: 'Submit paper order' }).click();
    await expect(orders(one)).toContainText('working');
    await expect(orders(two).locator('tbody tr')).toHaveCount(0);
  } finally { await a.close(); await b.close(); }
});

test('Tab advances focus without changing phase and laptop panels do not overflow horizontally', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await enter(page);
  const phase = await page.getByRole('button', { name: /PRE-MARKET/i }).first().innerText();
  await page.getByRole('button', { name: 'Search symbols' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /PRE-MARKET/i }).first()).toHaveText(phase);
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(width.scroll).toBe(width.viewport);
});
