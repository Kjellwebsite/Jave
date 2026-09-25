import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { startSingle } from './helpers';

const pages = ['/', '/#method', '/#setup', '/#library', '/#review'];

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`accessibility (${scheme})`, () => {
    test.use({ colorScheme: scheme });
    for (const route of pages) {
      test(`no serious violations on ${route}`, async ({ page }) => {
        await page.goto(route);
        await page.waitForTimeout(900);
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
      });
    }
  });
}

test('no serious violations in the runner', async ({ page }) => {
  await startSingle(page, 'Matrix inference');
  await page.waitForTimeout(600);
  let results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  await page.getByRole('button', { name: /Start practice/ }).click();
  await page.waitForTimeout(600);
  results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
});
