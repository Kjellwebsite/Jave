import { expect, type Page, test } from '@playwright/test';
import { capture } from './feature-capture';
import { signInAs } from './fixtures';

/**
 * Missions end to end: staff create and publish, members accept and submit
 * with evidence, staff assign and review — then the visual gauntlet.
 */
test.describe.configure({ mode: 'serial' });

const TITLE = 'Ground station uplink';
const BRIEF =
  'Bring up the ground station link to the lab cubesat and log one full pass.\nEvidence: the pass log.';
let missionPath = '';
let draftPath = '';

async function createMission(page: Page, title: string): Promise<string> {
  await page.goto('/missions');
  await page.getByTestId('new-mission').click();
  await page.waitForURL('**/missions/new');
  const form = page.getByRole('form', { name: 'Create draft' });
  await form.getByLabel('Title').fill(title);
  await form.getByLabel('Type').selectOption('build');
  await form.getByLabel('Brief').fill(BRIEF);
  await form.getByLabel('Capability').selectOption('create.technical');
  await form.getByLabel('Slots').fill('3');
  await form.getByLabel('Time limit (hours)').fill('72');
  await form.getByRole('button', { name: 'Create draft' }).click();
  await page.waitForURL(/\/missions\/[0-9a-f-]{36}\?saved=created/);
  await expect(page.getByText('DRAFT CREATED')).toBeVisible();
  return new URL(page.url()).pathname;
}

test('staff create a draft, see validation, and publish it', async ({ page }) => {
  await signInAs(page, 'operations');
  await page.goto('/missions/new');
  const form = page.getByRole('form', { name: 'Create draft' });
  await form.getByLabel('Title').fill('No');
  await form.getByLabel('Brief').fill('Too short');
  await form
    .getByLabel('Title')
    .evaluate((input: HTMLInputElement) => input.removeAttribute('minlength'));
  await form
    .getByLabel('Brief')
    .evaluate((input: HTMLTextAreaElement) => input.removeAttribute('minlength'));
  await form.getByRole('button', { name: 'Create draft' }).click();
  await expect(form.getByRole('alert').first()).toBeVisible();

  missionPath = await createMission(page, TITLE);
  await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
  await expect(page.getByText('DRAFT', { exact: true })).toBeVisible();

  await page.getByTestId('publish-mission').click();
  const dialog = page.getByRole('dialog', { name: 'Publish mission' });
  await dialog.getByRole('button', { name: 'Publish mission' }).click();
  await expect(
    page.getByText(/MISSION PUBLISHED — M-\d{4} — Ground station uplink\./),
  ).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();

  draftPath = await createMission(page, 'Telemetry archive audit');
});

test('members accept and submit with evidence; drafts stay invisible', async ({ page }) => {
  for (const persona of ['verified', 'member'] as const) {
    await signInAs(page, persona);
    await page.goto('/missions');
    await expect(page.getByText('Telemetry archive audit')).toHaveCount(0);
    await page.getByRole('link', { name: new RegExp(TITLE) }).click();
    await page.waitForURL(`**${missionPath}`);
    await page.getByTestId('accept-mission').click();
    await page
      .getByRole('dialog', { name: 'Accept mission' })
      .getByRole('button', {
        name: 'Accept mission',
      })
      .click();
    await expect(page.getByText(/MISSION ACCEPTED/)).toBeVisible();

    await page.getByTestId('submit-mission').click();
    const dialog = page.getByRole('dialog', { name: 'Submit work' });
    await dialog.getByLabel('Submission').fill(`Pass logged by ${persona}. Link margin 6 dB.`);
    await dialog.getByLabel('Evidence title').fill('Pass log');
    await dialog.getByLabel('Evidence link').fill('javascript:alert(1)');
    await dialog
      .getByLabel('Evidence link')
      .evaluate((input: HTMLInputElement) => input.setAttribute('type', 'text'));
    await dialog.getByRole('button', { name: 'Send submission' }).click();
    await expect(dialog.getByRole('alert').first()).toContainText(/http/);
    await dialog.getByLabel('Evidence link').fill('https://example.org/pass-log');
    await dialog.getByRole('button', { name: 'Send submission' }).click();
    await expect(page.getByText('SUBMISSION SENT — attempt 1 of 3.')).toBeVisible();
    await expect(page.getByText('AWAITING REVIEW', { exact: true })).toBeVisible();
  }
});

test('BREAK: members get no staff surface and no drafts', async ({ page }) => {
  await signInAs(page, 'member');
  await page.goto('/missions/new');
  await expect(page.getByText('ACCESS RESTRICTED')).toBeVisible();
  await page.goto(`${missionPath}/edit`);
  await expect(page.getByText('ACCESS RESTRICTED')).toBeVisible();
  await page.goto(draftPath);
  await expect(page.getByText('NOT FOUND', { exact: true })).toBeVisible();
  await expect(page.getByText('Telemetry archive audit')).toHaveCount(0);
  await page.goto(missionPath);
  await expect(page.getByTestId('publish-mission')).toHaveCount(0);
  await expect(page.getByTestId('assign-members')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Mission sections' })).toHaveCount(0);
});

test('staff assign members and review the queue', async ({ page }) => {
  await signInAs(page, 'operations');
  await page.goto(missionPath);
  await expect(page.locator('[data-assignment="dev_verified"]')).toContainText('AWAITING REVIEW');

  await page.getByTestId('assign-members').click();
  const assign = page.getByRole('dialog', { name: 'Assign members' });
  await assign.getByRole('searchbox', { name: 'Search members' }).fill('mara');
  await assign.getByLabel(/Mara Voss/).check();
  await assign.getByRole('button', { name: 'Assign' }).click();
  await expect(page.getByText(/1 ASSIGNED — members are notified/)).toBeVisible();
  await expect(page.locator('[data-assignment="mara"]')).toContainText('ASSIGNED');

  await page.getByRole('link', { name: /Review queue/ }).click();
  await page.waitForURL(/tab=review/);
  const unit = page.locator('[data-review-unit]').filter({ hasText: 'Dev Verified' });
  await expect(unit).toContainText('Pass logged by verified.');
  await expect(unit.getByRole('link', { name: /Pass log/ })).toHaveAttribute(
    'href',
    'https://example.org/pass-log',
  );
  await unit.getByRole('button', { name: 'Verify' }).click();
  const verify = page.getByRole('dialog', { name: 'Verify submission' });
  await verify.getByLabel('Feedback').fill('Clean pass. Logged on your record.');
  await verify.getByRole('button', { name: 'Verify' }).click();
  await expect(
    page.getByText(/SUBMISSION VERIFIED — recorded as evidence for 1 member\./),
  ).toBeVisible();
  await expect(page.locator('[data-review-unit]')).toHaveCount(1);
});

test('visual gauntlet', async ({ page }) => {
  test.setTimeout(240_000);
  await signInAs(page, 'operations');
  await capture(page, 'missions', '/missions');
  await capture(page, 'missions-new', '/missions/new');
  await capture(page, 'missions-detail', missionPath);
  await capture(page, 'missions-review', `${missionPath}?tab=review`);
  await capture(page, 'missions-empty', '/missions?status=archived');
  await signInAs(page, 'verified');
  await capture(page, 'missions-member', '/missions');
  await capture(page, 'missions-member-detail', missionPath);
});
