import { expect, test } from '@playwright/test';
import { collectErrors, playUntilReport, startSingle } from './helpers';

test('mobile: landing has no horizontal overflow', async ({ page }) => {
  const errors = await collectErrors(page);
  for (const route of ['/', '/#method', '/#setup', '/#library']) {
    await page.goto(route);
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, route).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
});

test('mobile: an instrument works with touch and the on-screen keypad', async ({ page }) => {
  await startSingle(page, 'Balance systems');
  await page.getByRole('button', { name: /Start practice/ }).click();
  await expect(page.locator('.keypad')).toBeVisible();
  await playUntilReport(page);
  await expect(page.getByText('Provisional · unnormed')).toBeVisible();
});
