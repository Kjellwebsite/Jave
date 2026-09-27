import { expect, type Page, test } from '@playwright/test';
import { type Persona, signInAs } from './fixtures';

/**
 * Projects and contributions, end to end through the real dashboard and
 * Postgres: create → move through the pipeline → milestones, links, team →
 * contributions reviewed by someone else → archive and staff restore.
 */
test.describe.configure({ mode: 'serial' });

/** Hostile-looking title: must render as text, never as markup. */
const TITLE = 'Orbital Relay <img src=x onerror=alert(1)>';
const PRIVATE_TITLE = 'Quiet Skunkworks';
/** The title once the owner cleans it up in Settings. */
const CLEAN_TITLE = 'Orbital Relay';
const REPO = 'javelin-labs/orbital-relay';
let projectPath = '';
let privatePath = '';

async function confirmDialog(page: Page, name: string, button = name): Promise<void> {
  const dialog = page.getByRole('dialog', { name });
  await dialog.getByRole('button', { name: button, exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** Sign out (drop the session cookie), then sign in as someone else. */
async function switchTo(page: Page, persona: Persona): Promise<void> {
  await page.context().clearCookies();
  await signInAs(page, persona);
}

async function openTab(page: Page, label: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Project sections' })
    .getByRole('link', { name: label })
    .click();
  await expect(
    page.getByRole('navigation', { name: 'Project sections' }).locator('[aria-current="page"]'),
  ).toHaveText(label);
}

test('a verified member starts a project; hostile text stays text', async ({ page }) => {
  let dialogs = 0;
  page.on('dialog', async (dialog) => {
    dialogs++;
    await dialog.dismiss();
  });
  await signInAs(page, 'verified');
  await page.goto('/projects');
  await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
  await page.getByRole('link', { name: 'Start project' }).first().click();
  await page.waitForURL('**/projects/new');

  const form = page.getByRole('form', { name: 'Project details' });
  await form.getByLabel('Title').fill(TITLE);
  await form.getByLabel('Summary').fill('Mesh relay for student cubesats.');
  await form.getByLabel('Visibility').selectOption('members');
  await form.getByLabel('Repository URL').fill('javascript:alert(1)');
  await form.getByRole('button', { name: 'Start project' }).click();
  // A javascript: URL passes the browser's URL check; core refuses every non-http(s) scheme.
  await expect(form.getByText('must be an http(s) URL without credentials').first()).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/new$/);
  await form.getByLabel('Repository URL').fill('');
  await form.getByRole('button', { name: 'Start project' }).click();

  await page.waitForURL(/\/projects\/orbital-relay[a-z0-9-]*\?created=1$/);
  projectPath = new URL(page.url()).pathname;
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE);
  await expect(page.getByText('PROJECT STARTED')).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expect(
    page.getByRole('list', { name: 'Project lifecycle' }).locator('[aria-current="step"]'),
  ).toContainText('Idea');
  expect(dialogs).toBe(0);
});

test('the owner moves it along the pipeline and plans milestones', async ({ page }) => {
  await signInAs(page, 'verified');
  await page.goto(projectPath);

  await page.getByTestId('change-status').click();
  const status = page.getByRole('dialog', { name: 'Change status' });
  await status.getByLabel('New status').selectOption('building');
  await status.getByRole('button', { name: 'Change status' }).click();
  await expect(page.getByText(/STATUS CHANGED — .* — now BUILDING\./)).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Project lifecycle' }).locator('[aria-current="step"]'),
  ).toContainText('Building');

  await openTab(page, 'Milestones');
  await page.getByTestId('add-milestone').click();
  const add = page.getByRole('dialog', { name: 'Add milestone' });
  await add.getByLabel('Milestone').fill('Static fire test');
  await add.getByLabel('Due date').fill('2026-12-01');
  await add.getByRole('button', { name: 'Add milestone' }).click();
  await expect(page.getByText('MILESTONE ADDED — Static fire test.')).toBeVisible();
  const milestone = page.locator('[data-milestone="Static fire test"]');
  await expect(milestone).toContainText('PLANNED');
  await expect(milestone).toContainText('due 2026-12-01');
  await page.getByTestId('complete-milestone-0').click();
  await expect(page.getByText('MILESTONE DONE — Static fire test.')).toBeVisible();
  await expect(milestone).toContainText('DONE');

  await openTab(page, 'Links');
  await page.getByTestId('add-link').click();
  const link = page.getByRole('dialog', { name: 'Add link' });
  await link.getByLabel('Label').fill('Design review');
  await link.getByLabel('URL').fill('https://example.org/design?draft=1');
  await link.getByRole('button', { name: 'Add link' }).click();
  await expect(page.getByText('LINK ADDED — Design review.')).toBeVisible();
  const anchor = page
    .getByRole('list', { name: 'Links' })
    .getByRole('link', { name: 'Design review' });
  await expect(anchor).toHaveAttribute('href', 'https://example.org/design?draft=1');
  await expect(anchor).toHaveAttribute('rel', /noopener/);
});

test('the owner edits details; linking a repository needs a verified account or staff', async ({
  page,
}) => {
  await signInAs(page, 'verified');
  await page.goto(`${projectPath}?tab=settings`);
  const details = page.getByRole('form', { name: 'Project details' });
  await details.getByLabel('Title').fill(CLEAN_TITLE);
  await details
    .getByLabel('Description')
    .fill('Store-and-forward relay that lets student cubesats share one ground station pass.');
  await details.getByLabel('Goals').fill('Relay 1 MB per pass. Survive a missed uplink window.');
  await details.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText(`PROJECT UPDATED — ${CLEAN_TITLE}.`)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(CLEAN_TITLE);

  // No staff-verified GitHub account: the owner cannot claim a repository.
  const repo = page.getByRole('form', { name: 'GitHub repository' });
  await repo.getByLabel('Repository').fill(REPO);
  await repo.getByRole('button', { name: 'Link repository' }).click();
  await expect(
    page.getByText('Link repositories through a staff-verified GitHub account'),
  ).toBeVisible();

  await switchTo(page, 'operations');
  await page.goto(`${projectPath}?tab=settings`);
  const staffRepo = page.getByRole('form', { name: 'GitHub repository' });
  await staffRepo.getByLabel('Repository').fill(`https://github.com/${REPO}`);
  await staffRepo.getByRole('button', { name: 'Link repository' }).click();
  await expect(page.getByText(`REPOSITORY LINKED — ${REPO}.`)).toBeVisible();
  const repoLink = page.getByRole('link', { name: REPO }).first();
  await expect(repoLink).toHaveAttribute('href', `https://github.com/${REPO}`);
  await expect(repoLink).toHaveAttribute('rel', /noopener/);
});

test('the owner adds a teammate by handle', async ({ page }) => {
  await signInAs(page, 'verified');
  await page.goto(`${projectPath}?tab=team`);
  await page.getByTestId('add-member').click();
  const add = page.getByRole('dialog', { name: 'Add member' });
  await add.getByLabel('Member handle').fill('@nobody_by_that_handle');
  await add.getByRole('button', { name: 'Add member' }).click();
  await expect(add.getByText('Profile not found.')).toBeVisible();
  await add.getByLabel('Member handle').fill('@dev_member');
  await add.getByLabel('Role').selectOption('contributor');
  await add.getByRole('button', { name: 'Add member' }).click();
  await expect(
    page.getByText('MEMBER ADDED — Dev Member — CONTRIBUTOR. They were notified.'),
  ).toBeVisible();
  await expect(page.locator('[data-member="dev_member"]')).toContainText('Contributor');
  await expect(page.getByText('Owners cannot leave. Transfer ownership first.')).toBeVisible();
});

test('a contributor records work; nobody verifies their own', async ({ page }) => {
  await signInAs(page, 'member');
  await page.goto(projectPath);
  await expect(page.getByText('YOU · CONTRIBUTOR')).toBeVisible();
  // Contributors do not manage the project.
  await expect(page.getByTestId('change-status')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);

  await page.getByTestId('record-contribution').click();
  const record = page.getByRole('dialog', { name: 'Record contribution' });
  await record.getByLabel('Kind').selectOption('code');
  await record.getByLabel('What you did').fill('Ground link parser');
  await record.getByLabel('Link').fill('https://example.org/pr/7');
  await record.getByRole('button', { name: 'Record contribution' }).click();
  await expect(page.getByText(/CONTRIBUTION RECORDED — Ground link parser/)).toBeVisible();

  await page.goto('/contributions?view=mine');
  const row = page.locator('[data-contribution="Ground link parser"]');
  await expect(row).toContainText('AWAITING REVIEW');
  await expect(row).toContainText('Yours · someone else reviews it');
  await expect(row.getByRole('button', { name: 'Verify' })).toHaveCount(0);

  // The review queue lists only work the viewer may review: never their own.
  await page.goto('/contributions?view=queue');
  await expect(page.getByText('QUEUE CLEAR')).toBeVisible();
  await expect(page.locator('[data-contribution="Ground link parser"]')).toHaveCount(0);
});

test('the owner verifies it from the review queue', async ({ page }) => {
  await signInAs(page, 'verified');
  await page.goto('/contributions?view=queue');
  const row = page.locator('[data-contribution="Ground link parser"]');
  await row.getByRole('button', { name: 'Verify' }).click();
  const dialog = page.getByRole('dialog', { name: 'Verify contribution' });
  await dialog.getByLabel('Note').fill('Reviewed the parser against flight logs.');
  await dialog.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(
    page.getByText('CONTRIBUTION VERIFIED — Ground link parser — accepted as evidence.'),
  ).toBeVisible();

  await page.goto(`${projectPath}?tab=contributions`);
  const verified = page.locator('[data-contribution="Ground link parser"]');
  await expect(verified).toContainText('VERIFIED');
  await expect(verified).toContainText('Reviewed the parser against flight logs.');

  await page.goto(`${projectPath}?tab=activity`);
  const feed = page.getByRole('list', { name: 'Project activity' });
  await expect(feed).toContainText('IDEA → BUILDING');
  await expect(feed).toContainText('Dev Member joined as CONTRIBUTOR');
  await expect(feed).toContainText('Milestone done');
});

test('staff review work on projects they are not on; the item waits in their queue', async ({
  page,
}) => {
  await signInAs(page, 'member');
  await page.goto(projectPath);
  await page.getByTestId('record-contribution').click();
  const record = page.getByRole('dialog', { name: 'Record contribution' });
  await record.getByLabel('Kind').selectOption('research');
  await record.getByLabel('What you did').fill('Uplink retry budget study');
  await record.getByRole('button', { name: 'Record contribution' }).click();
  await expect(page.getByText(/CONTRIBUTION RECORDED — Uplink retry budget study/)).toBeVisible();

  await switchTo(page, 'operations');
  await page.goto('/contributions');
  await expect(
    page.getByRole('navigation', { name: 'Contribution views' }).locator('[aria-current="page"]'),
  ).toHaveText('Review queue');
  const row = page.locator('[data-contribution="Uplink retry budget study"]');
  await expect(row).toContainText('AWAITING REVIEW');
  await expect(row.getByRole('button', { name: 'Verify' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Reject' })).toBeVisible();
});

test('BREAK: private projects are invisible to outsiders, by list and by URL', async ({ page }) => {
  await signInAs(page, 'verified');
  await page.goto('/projects/new');
  const form = page.getByRole('form', { name: 'Project details' });
  await form.getByLabel('Title').fill(PRIVATE_TITLE);
  await form.getByLabel('Visibility').selectOption('private');
  await form.getByRole('button', { name: 'Start project' }).click();
  await page.waitForURL(/\/projects\/quiet-skunkworks/);
  privatePath = new URL(page.url()).pathname;

  await switchTo(page, 'member');
  // A private project reads exactly like a missing one: same status, NOT FOUND,
  // nothing of it on the page. (The page streams behind its loading state, so
  // both answer with the same status.)
  const missing = await page.goto('/projects/no-such-project-anywhere');
  await expect(page.getByText('NOT FOUND')).toBeVisible();
  const hidden = await page.goto(privatePath);
  expect(hidden?.status()).toBe(missing?.status());
  await expect(page.getByText('NOT FOUND')).toBeVisible();
  await expect(page.getByText(PRIVATE_TITLE)).toHaveCount(0);
  await page.goto('/projects?q=skunkworks');
  await expect(page.getByText('NO MATCHES')).toBeVisible();
});

test('the owner archives; staff restore with a reason', async ({ page }) => {
  await signInAs(page, 'verified');
  await page.goto(`${privatePath}?tab=settings`);
  await page.getByTestId('archive-project').click();
  await confirmDialog(page, 'Archive project');
  await expect(page.getByText('This project is frozen.')).toBeVisible();
  await expect(page.getByTestId('change-status')).toHaveCount(0);

  await switchTo(page, 'operations');
  await page.goto(`${privatePath}?tab=settings`);
  await page.getByTestId('unarchive-project').click();
  const dialog = page.getByRole('dialog', { name: 'Restore project' });
  await dialog.getByRole('button', { name: 'Restore project' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Reason').fill('Archived by mistake during cleanup.');
  await dialog.getByRole('button', { name: 'Restore project' }).click();
  await expect(page.getByText(/PROJECT RESTORED — Quiet Skunkworks — now IDEA\./)).toBeVisible();
});

test('the directory filters by status and switches to a list', async ({ page }) => {
  await signInAs(page, 'founder');
  await page.goto('/projects');
  await page
    .getByRole('navigation', { name: 'Project status' })
    .getByRole('link', { name: 'Building' })
    .click();
  await expect(page).toHaveURL(/status=building/);
  await expect(page.locator('[data-project^="orbital-relay"]')).toBeVisible();
  await expect(page.locator('[data-project="quiet-skunkworks"]')).toHaveCount(0);
  await page.getByRole('link', { name: 'List' }).click();
  await expect(page).toHaveURL(/view=list/);
  await expect(page.getByRole('table', { name: 'Projects' })).toBeVisible();
});
