import { expect, type Page, test } from '@playwright/test';
import { capture } from './feature-capture';
import { signInAs } from './fixtures';

/**
 * Achievements end to end: the starter catalog, the criteria builder,
 * manual awards with four-eyes verification, and the member catalog.
 */
test.describe.configure({ mode: 'serial' });

async function defineAchievement(
  page: Page,
  values: {
    key: string;
    title: string;
    summary: string;
    rule?: { event: string; threshold: string };
    verification?: boolean;
  },
) {
  await page.getByTestId('new-achievement').click();
  const dialog = page.getByRole('dialog', { name: 'New achievement' });
  await dialog.getByLabel('Key').fill(values.key);
  await dialog.getByLabel('Title').fill(values.title);
  await dialog.getByLabel('Unlock line').fill(values.summary);
  await dialog.getByLabel('Description').fill(`${values.title}: ${values.summary}`);
  if (values.rule) {
    await dialog.getByLabel('How it is earned').selectOption('event_count');
    await dialog.getByLabel('Outcome').selectOption(values.rule.event);
    await dialog.getByLabel('Times').fill(values.rule.threshold);
  }
  if (values.verification) await dialog.getByLabel('Requires verification').click();
  await dialog.getByRole('button', { name: 'Create achievement' }).click();
  return dialog;
}

async function award(page: Page, handle: string, key: string, reason: string) {
  await page.getByTestId('award-achievement').click();
  const dialog = page.getByRole('dialog', { name: 'Award achievement' });
  await dialog.getByLabel('Member').fill(handle);
  await dialog.getByLabel('Achievement').selectOption(key);
  await dialog.getByLabel('Reason').fill(reason);
  await dialog.getByRole('button', { name: 'Award' }).click();
  return dialog;
}

test('core installs the starters and defines rules with the criteria builder', async ({ page }) => {
  await signInAs(page, 'core');
  await page.goto('/achievements');
  await page.getByTestId('seed-starters').click();
  await page
    .getByRole('dialog', { name: 'Install the starter catalog' })
    .getByRole('button', { name: 'Install starters' })
    .click();
  await expect(
    page.getByText(/STARTER CATALOG INSTALLED — 12 added, 1 already present/),
  ).toBeVisible();
  await expect(page.locator('[data-definition="relentless"]')).toContainText(
    'Mission verified × 25',
  );

  // First-step events count once: the builder pins the threshold to 1.
  await page.getByTestId('new-achievement').click();
  const farm = page.getByRole('dialog', { name: 'New achievement' });
  await farm.getByLabel('How it is earned').selectOption('event_count');
  await farm.getByLabel('Outcome').selectOption('project.created');
  await expect(farm.getByLabel('Times')).toHaveValue('1');
  await expect(farm.getByLabel('Times')).toHaveAttribute('readonly', '');
  await farm.getByRole('button', { name: 'Close' }).click();

  const orbit = await defineAchievement(page, {
    key: 'orbit_certified',
    title: 'Orbit certified',
    summary: '2 missions verified.',
    rule: { event: 'mission.completed', threshold: '2' },
  });
  await expect(
    page.getByText('ACHIEVEMENT DEFINED — ORBIT CERTIFIED — 2 missions verified.'),
  ).toBeVisible();
  await expect(orbit).toBeHidden();
  await expect(page.locator('[data-definition="orbit_certified"]')).toContainText(
    'Mission verified × 2',
  );

  const duplicate = await defineAchievement(page, {
    key: 'orbit_certified',
    title: 'Orbit again',
    summary: 'Duplicate key.',
  });
  await expect(duplicate.getByRole('alert').first()).toContainText('already exists');
  await duplicate.getByRole('button', { name: 'Close' }).click();

  await defineAchievement(page, {
    key: 'mentor',
    title: 'Mentor',
    summary: 'Brought someone else up to speed.',
    verification: true,
  });
  await expect(
    page.getByText('ACHIEVEMENT DEFINED — MENTOR — Brought someone else up to speed.'),
  ).toBeVisible();

  await page.getByTestId('edit-orbit_certified').click();
  const edit = page.getByRole('dialog', { name: 'Edit Orbit certified' });
  await edit.getByLabel('Active').click();
  await edit.getByRole('button', { name: 'Save achievement' }).click();
  await expect(page.getByText('ACHIEVEMENT UPDATED — ORBIT CERTIFIED.')).toBeVisible();
  await expect(page.locator('[data-definition="orbit_certified"]')).toContainText('INACTIVE');
});

test('operations award by hand; the award waits for a second person', async ({ page }) => {
  await signInAs(page, 'operations');
  await page.goto('/achievements');
  await expect(page.getByTestId('new-achievement')).toHaveCount(0);
  await award(page, '@mara', 'mentor', 'Mentored the autumn build cohort.');
  await expect(
    page.getByText(/ACHIEVEMENT AWARDED — MENTOR — Mara Voss\. Pending verification/),
  ).toBeVisible();
  await award(page, '@sana', 'mentor', 'Ran the research reading group.');
  await expect(page.getByText(/ACHIEVEMENT AWARDED — MENTOR — Sana Okafor\./)).toBeVisible();

  const unknown = await award(page, '@nobody_here', 'mentor', 'Nobody by that handle.');
  await expect(unknown.getByRole('alert').first()).toContainText('No member with that handle.');
  await unknown.getByRole('button', { name: 'Cancel' }).click();

  await page.getByTestId('revoke-achievement').click();
  const revoke = page.getByRole('dialog', { name: 'Revoke achievement' });
  await revoke.getByLabel('Member').fill('@priya');
  await revoke.getByLabel('Achievement').selectOption('keystone');
  await revoke.getByLabel('Reason').fill('She never held it.');
  await revoke.getByRole('button', { name: 'Revoke' }).click();
  await expect(revoke.getByRole('alert').first()).toContainText(/not found/i);
  await revoke.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('link', { name: /Pending verification/ }).click();
  await page.waitForURL(/tab=pending/);
  await expect(page.getByText('You awarded it')).toHaveCount(2);
});

test('core verifies one pending award', async ({ page }) => {
  await signInAs(page, 'core');
  await page.goto('/achievements?tab=pending');
  const row = page.getByRole('row').filter({ hasText: 'Mara Voss' });
  await row.getByRole('button', { name: 'Verify' }).click();
  await page
    .getByRole('dialog', { name: 'Verify award' })
    .getByRole('button', { name: 'Verify award' })
    .click();
  await expect(page.getByText('ACHIEVEMENT VERIFIED — MENTOR — Mara Voss.')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Mara Voss' })).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'Sana Okafor' })).toHaveCount(1);
});

test('BREAK: members see a read-only catalog with hidden entries masked', async ({ page }) => {
  await signInAs(page, 'member');
  await page.goto('/achievements');
  await expect(page.getByText(/CATALOG · 0 OF \d+ UNLOCKED/)).toBeVisible();
  await expect(page.getByText('HIDDEN', { exact: true }).first()).toBeVisible();
  await expect(page.locator('[data-achievement="adversary"]')).toHaveCount(0);
  await expect(page.locator('[data-achievement="orbit_certified"]')).toHaveCount(0);
  for (const control of ['new-achievement', 'seed-starters', 'award-achievement']) {
    await expect(page.getByTestId(control)).toHaveCount(0);
  }
  await page.goto('/achievements?tab=pending');
  await expect(page.getByText('Pending verification')).toHaveCount(0);
});

test('visual gauntlet', async ({ page }) => {
  test.setTimeout(240_000);
  await signInAs(page, 'core');
  await capture(page, 'achievements', '/achievements');
  await capture(page, 'achievements-pending', '/achievements?tab=pending');
  await signInAs(page, 'member');
  await capture(page, 'achievements-member', '/achievements');
});
