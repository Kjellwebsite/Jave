import { expect, test } from '@playwright/test';
import { collectErrors, playUntilReport, startSingle, storedResponses } from './helpers';

test('landing renders and leads to setup', async ({ page }) => {
  const errors = await collectErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /JVLN/ })).toBeVisible();
  await page.getByRole('button', { name: 'Begin assessment' }).click();
  await expect(page).toHaveURL(/#setup/);
  await expect(page.getByRole('button', { name: /Begin core assessment/ })).toBeDisabled();
  await page.getByLabel(/I understand/).check();
  await expect(page.getByRole('button', { name: /Begin core assessment/ })).toBeEnabled();
  expect(errors).toEqual([]);
});

test('a single instrument runs end to end and produces a report', async ({ page }) => {
  const errors = await collectErrors(page);
  await startSingle(page, 'Sequence induction');
  await playUntilReport(page);
  await expect(page.getByText('Provisional · unnormed')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Summary/i })).toBeVisible();
  expect(errors).toEqual([]);
});

test('double submission counts once', async ({ page }) => {
  await startSingle(page, 'Sequence induction');
  await page.getByRole('button', { name: /Start practice/ }).click();
  // Skip through practice
  for (let i = 0; i < 2; i++) {
    await page.locator('.entry-input').fill('1');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  await page.getByRole('button', { name: 'Begin' }).click();
  const before = await storedResponses(page);
  await page.locator('.entry-input').fill('5');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  expect((await storedResponses(page)) - before).toBe(1);
});

test('reloading mid-item voids the item and resumes', async ({ page }) => {
  const errors = await collectErrors(page);
  await startSingle(page, 'Matrix inference');
  await page.getByRole('button', { name: /Start practice/ }).click();
  await expect(page.locator('.mx-grid')).toBeVisible();
  const pending = () =>
    page.evaluate(() => {
      const id = localStorage.getItem('jvln.v1.active')!;
      const s = JSON.parse(localStorage.getItem(`jvln.v1.${id}`)!);
      return { step: s.pending?.stepId as string, voided: s.events.filter((e: { type: string }) => e.type === 'void').length as number };
    });
  const before = await pending();
  await page.reload();
  await expect(page.locator('.mx-grid')).toBeVisible();
  const after = await pending();
  expect(after.step).not.toBe(before.step);
  expect(after.voided).toBe(before.voided + 1);
  expect(errors).toEqual([]);
});

test('back button leaves the runner and the session can be resumed', async ({ page }) => {
  await startSingle(page, 'Relational deduction');
  await page.getByRole('button', { name: /Start practice/ }).click();
  await page.goBack();
  await expect(page).not.toHaveURL(/#assessment/);
  await page.goto('/#setup');
  await expect(page.getByText('Assessment in progress')).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.locator('.premises')).toBeVisible();
});

test('pause replaces the open item', async ({ page }) => {
  await startSingle(page, 'Matrix inference');
  await page.getByRole('button', { name: /Start practice/ }).click();
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.mx-grid')).toBeVisible();
});

test('keyboard-only practice answer', async ({ page }) => {
  await startSingle(page, 'Matrix inference');
  await expect(page.getByRole('button', { name: /Start practice/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.mx-grid')).toBeVisible();
  await page.keyboard.press('3');
  await expect(page.locator('.choice-option').nth(2)).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Correct\.|Not quite\./)).toBeVisible();
});

test('a procedure task completes', async ({ page }) => {
  const errors = await collectErrors(page);
  await startSingle(page, 'Rule discovery');
  await page.getByRole('button', { name: 'Begin' }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  for (let i = 0; i < 64 && !page.url().includes('#report'); i++) {
    const keys = page.locator('.rules-key');
    if ((await keys.count()) === 0) break;
    await keys.nth(i % 4).click();
    await page.waitForTimeout(820);
  }
  await expect(page).toHaveURL(/#report/, { timeout: 15_000 });
  await expect(page.getByText('Rules found')).toBeVisible();
  expect(errors).toEqual([]);
});

test('report handles corrupted storage without crashing', async ({ page }) => {
  const errors = await collectErrors(page);
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('jvln.v1.sessions', '{broken');
    localStorage.setItem('jvln.v1.active', 'missing');
  });
  await page.goto('/#report');
  await expect(page.getByText('No completed assessment on this device.')).toBeVisible();
  await page.goto('/#assessment');
  await expect(page.getByText('No assessment in progress')).toBeVisible();
  expect(errors).toEqual([]);
});
