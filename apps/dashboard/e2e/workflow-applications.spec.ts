import { spawnSync } from 'node:child_process';
import { expect, type Page, test } from '@playwright/test';
import { type Persona, signInAs } from './fixtures';

/**
 * Applications and verification, end to end: the applicant's self-service
 * page, the staff queue and decision flow, conflict-of-interest and access
 * refusals, and the verification queue with its decisions.
 *
 * The fixtures (e2e/applications-fixtures.ts) are added to the shared seed
 * here. Every submission notifies the reviewers, founder included, so this
 * file is named to run after the specs that count the founder's inbox
 * (Playwright runs files in name order, one worker).
 */

/** Must match playwright.config.ts: the database the server under test uses. */
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://jave:jave@localhost:5432/jave_e2e_dash';
const INTERVIEW_LEAD_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  const seeded = spawnSync('pnpm', ['exec', 'tsx', 'e2e/applications-fixtures.ts'], {
    env: { ...process.env, DATABASE_URL },
    encoding: 'utf8',
  });
  if (seeded.status !== 0) throw new Error(`applications fixtures failed: ${seeded.stderr}`);
});

/** Signs in as `persona`, dropping any earlier session (the login page redirects a live one). */
async function signInFresh(page: Page, persona: Persona): Promise<void> {
  await page.context().clearCookies();
  await signInAs(page, persona);
}

/** The detail link of one application or verification, read from its queue as the founder. */
async function recordHref(page: Page, queue: string, reference: string): Promise<string> {
  await page.goto(queue);
  const href = await page.getByRole('link', { name: new RegExp(reference) }).getAttribute('href');
  if (!href) throw new Error(`no link for ${reference}`);
  return href;
}

/** A datetime-local value a few days ahead (the page reads it in the viewer's zone). */
function interviewValue(): string {
  return new Date(Date.now() + INTERVIEW_LEAD_DAYS * DAY_MS).toISOString().slice(0, 16);
}

test.describe('applicant self-service', () => {
  test('a member drafts, submits and withdraws an application', async ({ page }) => {
    await signInFresh(page, 'member');
    await page.goto('/me');
    await page.getByRole('link', { name: 'My application' }).click();
    await page.waitForURL('**/me/application');
    await expect(page.getByRole('banner')).toContainText('My application');
    await page.getByRole('button', { name: 'Start application' }).click();
    const save = page.getByRole('button', { name: 'Save draft' });
    await expect(save).toBeVisible();

    await page.getByLabel('Why JAVELIN').fill('Too short.');
    await save.click();
    await expect(page.getByText(/DRAFT SAVED — 4 requirements left/)).toBeVisible();
    const missing = page.getByRole('list', { name: 'Missing before submission' });
    await expect(missing).toContainText('Choose a primary domain.');
    await expect(missing).toContainText('Motivation needs at least 30 characters.');
    await expect(page.getByRole('button', { name: 'Submit application' })).toHaveCount(0);

    // BREAK: a script URL is refused and nothing is stored.
    await page.getByLabel('Evidence links').fill('javascript:alert(1)');
    await save.click();
    await expect(
      page.getByText('must be an http(s) URL without credentials', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Nothing was saved. Fix the marked answers')).toBeVisible();
    await expect(page.getByLabel('Evidence links')).toHaveAttribute('aria-invalid', 'true');
    await page.reload();
    await expect(page.getByLabel('Evidence links')).toHaveValue('');

    await page.getByLabel('Primary domain').selectOption('create');
    await page
      .getByLabel('Why JAVELIN')
      .fill('<b>I build</b> flight software and want peers who ship under real constraints.');
    await page
      .getByLabel('Experience')
      .fill('Two years on a student cubesat team; I own the attitude-control loop.');
    await page.getByLabel('Evidence links').fill('https://github.com/example/orbit');
    await save.click();
    await expect(page.getByText('DRAFT SAVED — ready to submit.')).toBeVisible();

    await page.getByRole('button', { name: 'Submit application' }).click();
    const submit = page.getByRole('dialog', { name: 'Submit application' });
    await submit.getByRole('button', { name: 'Submit application' }).click();
    await expect(page.getByText(/APPLICATION SUBMITTED — APP-\d{4}/)).toBeVisible();

    const answers = page.locator('section', { hasText: 'Your answers' });
    await expect(answers).toContainText('<b>I build</b> flight software');
    await expect(answers.locator('b')).toHaveCount(0);
    await expect(page.getByText('SUBMITTED').first()).toBeVisible();

    await page.getByRole('button', { name: 'Withdraw' }).click();
    const withdraw = page.getByRole('dialog', { name: 'Withdraw application' });
    await expect(withdraw).toContainText('You could submit again from');
    await withdraw.getByLabel('Reason').fill('Applying next season with a finished project.');
    await withdraw.getByRole('button', { name: 'Withdraw application' }).click();
    await expect(page.getByText(/WITHDRAWN — APP-\d{4}\. You can submit again from/)).toBeVisible();
    await expect(page.getByText('Withdrawn. You can start a new application.')).toBeVisible();
    await expect(page.getByText('COOLDOWN')).toBeVisible();
  });

  test('BREAK: members get no staff pages', async ({ page }) => {
    await signInFresh(page, 'founder');
    const vera = await recordHref(page, '/applications?number=APP-0002', 'APP-0002');
    await signInFresh(page, 'member');
    await page.goto('/applications');
    await expect(page.getByText('ACCESS RESTRICTED')).toBeVisible();
    await expect(page.getByText('canViewApplications')).toBeVisible();
    await page.goto(vera);
    await expect(page.getByText('ACCESS RESTRICTED')).toBeVisible();
    await expect(page.getByText('Vera Lind')).toHaveCount(0);
  });
});

test.describe('staff review', () => {
  test('claim, review and accept from the staff view', async ({ page }) => {
    await signInFresh(page, 'founder');
    await page.goto('/applications');
    await page.getByRole('searchbox', { name: 'Application number' }).fill('app-2');
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.waitForURL(/number=app-2/);
    const rows = page.getByRole('table', { name: 'Applications' }).locator('tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Vera Lind');
    await rows.first().getByRole('link').click();
    await expect(page.getByRole('heading', { level: 1, name: 'APP-0002' })).toBeVisible();
    await expect(page.getByText('Dr. Ines Alvarez, lab lead')).toBeVisible();

    await page.getByRole('button', { name: 'Claim' }).click();
    await page
      .getByRole('dialog', { name: 'Claim for review' })
      .getByRole('button', { name: 'Claim application' })
      .click();
    await expect(page.getByText('CLAIMED — APP-0002. It is assigned to you.')).toBeVisible();

    await page.getByRole('button', { name: 'Review', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Review' });
    await review.getByLabel('Recommendation').selectOption('accept');
    await review.getByLabel('Score').selectOption('4');
    await review.getByLabel('Note').fill('Shipped, maintained, and used by two labs.');
    await review.getByRole('button', { name: 'Record review' }).click();
    await expect(page.getByText('REVIEW RECORDED — ACCEPT · 4/5.')).toBeVisible();

    await page.getByRole('button', { name: 'Accept', exact: true }).click();
    const accept = page.getByRole('dialog', { name: 'Accept APP-0002' });
    await expect(accept).toContainText('Grants TRIAL');
    await accept.getByRole('button', { name: 'Accept application' }).click();
    // The internal reason is required: the browser refuses an empty one.
    await expect(accept).toBeVisible();
    await accept.getByLabel('Internal reason').fill('Sustained, verifiable proof of work.');
    await accept
      .getByLabel('Message to the applicant')
      .fill('Welcome. Your first trial opens soon.');
    await accept.getByRole('button', { name: 'Accept application' }).click();
    await expect(page.getByText('APPLICATION ACCEPTED — APP-0002 — TRIAL granted.')).toBeVisible();
    await expect(page.getByText('ACCEPTED').first()).toBeVisible();
    await expect(page.getByText('Sustained, verifiable proof of work.')).toBeVisible();
    await expect(page.getByTestId('application-actions')).toHaveCount(0);
  });

  test('an interview is scheduled in the viewer’s time zone', async ({ page }) => {
    await signInFresh(page, 'founder');
    await page.goto(await recordHref(page, '/applications?number=APP-0003', 'APP-0003'));
    await page.getByRole('button', { name: 'Interview' }).click();
    const dialog = page.getByRole('dialog', { name: 'Schedule interview' });
    await dialog.getByLabel('When').fill(interviewValue());
    await dialog.getByLabel('Message to the applicant').fill('Voice channel: Briefing Room.');
    await dialog.getByRole('button', { name: 'Schedule interview' }).click();
    await expect(
      page.getByText(/INTERVIEW SET — APP-0003 — \d{4}-\d{2}-\d{2} \d{2}:\d{2}/),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Move interview' })).toBeVisible();
  });

  test('BREAK: a staff member never sees or acts on their own application', async ({ page }) => {
    await signInFresh(page, 'founder');
    const own = await recordHref(page, '/applications?number=APP-0006', 'APP-0006');
    await signInFresh(page, 'operations');
    await page.goto('/applications?status=all');
    await expect(page.getByRole('link', { name: /APP-0006/ })).toHaveCount(0);
    await page.goto(own);
    await expect(page.getByText('ACCESS RESTRICTED')).toBeVisible();
    await expect(page.getByText('You cannot act on your own application.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open your application' })).toBeVisible();
    await expect(page.getByTestId('application-actions')).toHaveCount(0);
  });
});

test.describe('verification queue', () => {
  test('a verifier starts a review and approves an identity claim', async ({ page }) => {
    await signInFresh(page, 'operations');
    await page.goto('/verification');
    await expect(page.getByRole('table', { name: 'Verifications' })).toContainText('Tomas Reyes');
    await page.getByRole('link', { name: /VER-0001/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'VER-0001' })).toBeVisible();
    await expect(page.getByText('Identity · grants VERIFIED')).toBeVisible();

    await page.getByRole('button', { name: 'Start review' }).click();
    await page
      .getByRole('dialog', { name: 'Start review' })
      .getByRole('button', { name: 'Start review' })
      .click();
    await expect(page.getByText('IN REVIEW — VER-0001. Assigned to you.')).toBeVisible();

    await page.getByRole('button', { name: 'Approve' }).click();
    const approve = page.getByRole('dialog', { name: 'Approve' });
    await expect(approve).toContainText('Grants the VERIFIED role');
    await approve.getByLabel('Decision note').fill('Matched the finals programme and a live call.');
    await approve.getByRole('button', { name: 'Approve verification' }).click();
    await expect(page.getByText('VERIFICATION APPROVED — VER-0001.')).toBeVisible();
    await expect(page.getByText('APPROVED').first()).toBeVisible();
  });

  test('skill approvals need rank authority, and grant the chosen rank', async ({ page }) => {
    await signInFresh(page, 'founder');
    const skill = await recordHref(page, '/verification', 'VER-0002');

    await signInFresh(page, 'operations');
    await page.goto(skill);
    await expect(page.getByText('NO CONTROLS FOR YOU HERE')).toBeVisible();
    await expect(page.getByTestId('verification-actions')).toHaveCount(0);

    await signInFresh(page, 'core');
    await page.goto(skill);
    await page.getByRole('button', { name: 'Approve' }).click();
    const approve = page.getByRole('dialog', { name: 'Approve' });
    await expect(approve.getByLabel('Rank to grant')).toHaveValue('A');
    await approve.getByLabel('Rank to grant').selectOption('B');
    await approve
      .getByLabel('Decision note')
      .fill('The flight computer holds up; B until flight data.');
    await approve.getByRole('button', { name: 'Approve verification' }).click();
    await expect(page.getByText('VERIFICATION APPROVED — VER-0002 — verified at B.')).toBeVisible();
  });

  test('an approval is revoked with a reason', async ({ page }) => {
    await signInFresh(page, 'founder');
    await page.goto(await recordHref(page, '/verification?status=approved', 'VER-0003'));
    await page.getByRole('button', { name: 'Revoke' }).click();
    const revoke = page.getByRole('dialog', { name: 'Revoke approval' });
    await revoke.getByLabel('Reason').fill('The merge was reverted upstream.');
    await revoke.getByRole('button', { name: 'Revoke verification' }).click();
    await expect(page.getByText('VERIFICATION REVOKED — VER-0003.')).toBeVisible();
    await expect(page.getByText('The merge was reverted upstream.')).toBeVisible();
  });

  test('BREAK: another member’s verification does not exist for a member', async ({ page }) => {
    await signInFresh(page, 'founder');
    const other = await recordHref(page, '/verification?status=all', 'VER-0004');
    await signInFresh(page, 'member');
    await page.goto(other);
    await expect(page.getByText('NOT FOUND')).toBeVisible();
    await expect(page.getByText('Ground station')).toHaveCount(0);
    await page.goto('/verification');
    await expect(page.getByText('NO OPEN REQUESTS')).toBeVisible();
  });
});
