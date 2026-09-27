import { expect, type Locator, type Page, test } from '@playwright/test';
import { signInAs } from './fixtures';
import { TRIAL_FIXTURES } from './seed-trials';

/**
 * Trials, end to end: the state machine driven from the dashboard by staff
 * personas against the seeded trials (e2e/seed-trials.ts). Tests run in
 * order and each moves its own trial forward.
 */
test.describe.configure({ mode: 'serial' });

async function openTrial(page: Page, title: string, tab?: string): Promise<string> {
  await page.goto('/trials');
  await page
    .getByRole('link', { name: new RegExp(title) })
    .first()
    .click();
  await page.waitForURL(/\/trials\/[0-9a-f-]{36}$/);
  const url = new URL(page.url()).pathname;
  if (tab) {
    await page
      .getByRole('navigation', { name: 'Trial sections' })
      .getByRole('link', { name: new RegExp(`^${tab}`) })
      .click();
    await page.waitForURL(/tab=/);
  }
  return url;
}

function toast(page: Page, text: string | RegExp) {
  return page.getByRole('list', { name: 'Notifications' }).getByText(text);
}

test.describe('trial staff (founder)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, 'founder');
  });

  test('the list shows every state with counts and filters', async ({ page }) => {
    await page.goto('/trials');
    const readouts = page.getByRole('region', { name: 'Trial readouts' });
    await expect(readouts.getByText('RECRUITING')).toBeVisible();
    const table = page.getByRole('table', { name: 'Trials' });
    for (const title of Object.values(TRIAL_FIXTURES))
      await expect(table.getByText(title, { exact: true })).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Trial states' })
      .getByRole('link', { name: /^Cancelled/ })
      .click();
    await page.waitForURL(/status=cancelled/);
    await expect(table.locator('tbody tr')).toHaveCount(1);
    await expect(table).toContainText(TRIAL_FIXTURES.cancelled);
    // BREAK: an unknown state in the URL is ignored, not an error.
    await page.goto('/trials?status=%27%3Bdrop');
    await expect(page.getByRole('heading', { level: 1, name: 'Trials' })).toBeVisible();
  });

  test('a trial is created from a template and recruitment is opened', async ({ page }) => {
    await page.goto('/trials/new');
    await page.getByTestId('template-select').selectOption({ label: '48-Hour Ship' });
    const title = page.getByLabel('Title');
    await expect(title).toHaveValue('48-Hour Ship');
    await title.fill('Relay Sprint');
    await expect(page.locator('[data-criterion]')).toHaveCount(5);
    await page.getByRole('button', { name: 'Create draft' }).click();
    await page.waitForURL(/\/trials\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Relay Sprint' })).toBeVisible();
    await expect(page.locator('[data-status="draft"]').first()).toBeVisible();

    await page.getByTestId('open-recruitment').click();
    const dialog = page.getByRole('dialog', { name: 'Open recruitment' });
    await dialog.getByRole('button', { name: 'Open recruitment' }).click();
    await expect(toast(page, /RECRUITMENT OPEN — TRIAL-\d{4}/)).toBeVisible();
    await expect(page.locator('[data-status="recruiting"]').first()).toBeVisible();
  });

  test('BREAK: a custom trial with an invalid rubric is refused on its field', async ({ page }) => {
    await page.goto('/trials/new');
    await page.getByLabel('Title').fill('No rubric weight');
    await page.getByLabel('Public summary').fill('A summary long enough to pass.');
    await page
      .getByLabel('Brief (sealed)')
      .fill('A sealed brief long enough to pass the minimum length for a brief, with details.');
    await page.getByLabel('Weight').fill('');
    await page.getByLabel('Weight').evaluate((input) => input.removeAttribute('required'));
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: /greater than 0|weight/i })
        .first(),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/trials\/new$/);
  });

  test('participants are drawn, teams previewed and assigned, the trial started and closed', async ({
    page,
  }) => {
    const path = await openTrial(page, TRIAL_FIXTURES.recruiting, 'Participants');
    await page.getByTestId('random-selection').click();
    const draw = page.getByRole('dialog', { name: 'Random selection' });
    await draw.getByLabel('How many').fill('4');
    await draw.getByLabel('Seed').fill('e2e-draw');
    await draw.getByRole('button', { name: 'Draw participants' }).click();
    await expect(
      toast(page, 'PARTICIPANTS SELECTED — 4 of 6 eligible. Seed e2e-draw.'),
    ).toBeVisible();

    // Manual selection: everyone in the pool.
    for (const box of await page.getByRole('checkbox').all()) await box.check();
    await page.getByTestId('save-selection').click();
    await expect(toast(page, 'PARTICIPANTS SELECTED — 6 of 6 eligible.')).toBeVisible();

    await page.goto(`${path}?tab=teams`);
    await page.getByLabel('Team size').fill('2');
    await page.getByLabel('Seed').fill('e2e-teams');
    await page.getByTestId('preview-teams').click();
    await page.waitForURL(/seed=e2e-teams/);
    const preview = page.getByTestId('team-preview');
    await expect(preview).toContainText('seed e2e-teams');
    const roster = async (team: Locator) => ({
      members: (
        await team
          .locator('[data-member]')
          .evaluateAll((items) => items.map((item) => item.getAttribute('data-member')))
      ).sort(),
      lead: await team.locator('[data-lead]').getAttribute('data-member'),
    });
    const previewTeams = preview.locator('[data-preview-team]');
    await expect(previewTeams).toHaveCount(3);
    const planned = new Map<string, Awaited<ReturnType<typeof roster>>>();
    for (const team of await previewTeams.all())
      planned.set((await team.getAttribute('data-preview-team'))!, await roster(team));

    await page.getByTestId('assign-teams').click();
    const assign = page.getByRole('dialog', { name: 'Assign teams' });
    await assign.getByRole('button', { name: 'Assign teams' }).click();
    await expect(toast(page, 'TEAMS ASSIGNED — 3 teams of 2. Seed e2e-teams.')).toBeVisible();
    // What was previewed is exactly what was created: same names, members and leads.
    const teams = page.getByRole('list', { name: 'Teams' }).locator(':scope > li');
    await expect(teams).toHaveCount(3);
    for (const [name, expected] of planned)
      expect(await roster(page.locator(`[data-team="${name}"]`))).toEqual(expected);

    await page.goto(path);
    await page.getByTestId('start-trial').click();
    await page
      .getByRole('dialog', { name: 'Start trial' })
      .getByRole('button', { name: 'Start trial' })
      .click();
    await expect(toast(page, /TRIAL LIVE — TRIAL-\d{4}/)).toBeVisible();
    await expect(page.locator('[data-status="active"]').first()).toBeVisible();

    await page.getByTestId('close-submissions').click();
    await page
      .getByRole('dialog', { name: 'Close submissions' })
      .getByRole('button', { name: 'Close submissions' })
      .click();
    await expect(toast(page, 'SUBMISSIONS CLOSED — 0 of 3 teams submitted.')).toBeVisible();
    await expect(page.locator('[data-status="evaluating"]').first()).toBeVisible();
  });

  test('a team is scored with a live weighted total; results publish; a rank is applied', async ({
    page,
  }) => {
    const path = await openTrial(page, TRIAL_FIXTURES.evaluating, 'Evaluation');
    await expect(page.getByText('EVALUATOR RULES')).toBeVisible();
    await page.getByTestId('score-UNIT ALPHA').click();
    const dialog = page.getByRole('dialog', { name: 'Record scores' });
    await dialog.getByLabel('Outcome · 50%').fill('9');
    await dialog.getByLabel('Judgement · 33%').fill('8');
    await expect(dialog.getByTestId('weighted-preview')).toHaveText('—');
    await dialog.getByLabel('Clarity · 17%').fill('7');
    // (3·9 + 2·8 + 1·7) / 6
    await expect(dialog.getByTestId('weighted-preview')).toHaveText('8.33');
    await dialog.getByRole('button', { name: 'Record scores' }).click();
    await expect(toast(page, 'EVALUATION RECORDED — 8.33 weighted.')).toBeVisible();
    await expect(page.locator('[data-team="UNIT ALPHA"] [data-evaluation="mine"]')).toContainText(
      '8.33',
    );

    await page.goto(`${path}?tab=results`);
    await expect(page.getByText('NOT YET SCORED')).toBeVisible();
    await page.getByTestId('publish-results').click();
    const publish = page.getByRole('dialog', { name: 'Publish results' });
    // BREAK: unevaluated work is not published silently.
    await publish.getByRole('button', { name: 'Publish results' }).click();
    await expect(publish.getByRole('alert')).toContainText(
      /not evaluated|unevaluated|acknowledge/i,
    );
    await publish.getByText('Publish anyway, marking them incomplete').click();
    await publish.getByRole('button', { name: 'Publish results' }).click();
    await expect(toast(page, /RESULTS PUBLISHED — /)).toBeVisible();
    await expect(page.getByText('Published', { exact: true })).toBeVisible();

    const apply = page.locator('[data-testid^="apply-rank-"]').first();
    await apply.click();
    const rank = page.getByRole('dialog', { name: 'Apply rank consequence' });
    await rank.getByRole('button', { name: 'Apply verified rank' }).click();
    await expect(toast(page, /RANK VERIFIED — /)).toBeVisible();
    await expect(page.locator('[data-rank-applied="true"]').first()).toBeVisible();
  });

  test('templates: installing starters is idempotent; a template is deactivated and restored', async ({
    page,
  }) => {
    await page.goto('/trials/templates');
    await page.getByTestId('seed-templates').click();
    await expect(
      toast(page, 'Starter templates already installed. Nothing changed.'),
    ).toBeVisible();
    await page.getByRole('link', { name: /Brief the Board/ }).click();
    await page.waitForURL(/\/trials\/templates\/[0-9a-f-]{36}$/);
    await page.getByRole('button', { name: 'Deactivate' }).click();
    await page
      .getByRole('dialog', { name: 'Deactivate template' })
      .getByRole('button', { name: 'Deactivate' })
      .click();
    await expect(toast(page, /TEMPLATE DEACTIVATED — Brief the Board/)).toBeVisible();
    await expect(page.getByText('INACTIVE', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Reactivate' }).click();
    await page
      .getByRole('dialog', { name: 'Reactivate template' })
      .getByRole('button', { name: 'Reactivate' })
      .click();
    await expect(toast(page, /TEMPLATE REACTIVATED — Brief the Board/)).toBeVisible();
  });
});

test.describe('adversarial control room (two people)', () => {
  test('operations staff never see the adversarial tab or any hint of a role', async ({ page }) => {
    await signInAs(page, 'operations');
    const path = await openTrial(page, TRIAL_FIXTURES.adversarial);
    const tabs = page.getByRole('navigation', { name: 'Trial sections' });
    await expect(tabs.getByRole('link', { name: 'Adversarial' })).toHaveCount(0);
    for (const query of ['', '?tab=adversarial', '?tab=teams', '?tab=participants']) {
      await page.goto(`${path}${query}`);
      await expect(page.getByTestId('sandbox-banner')).toHaveCount(0);
      await expect(page.locator('main')).not.toContainText(/adversar|operative|sandbox · /i);
    }
  });

  test('the founder authorizes a role planned by CORE, briefs, activates and observes', async ({
    page,
  }) => {
    await signInAs(page, 'founder');
    await openTrial(page, TRIAL_FIXTURES.adversarial, 'Adversarial');
    await expect(page.getByTestId('sandbox-banner')).toContainText('FICTIONAL DATA ONLY');
    const role = page.locator('article[data-role]');
    await expect(role).toContainText('Awaiting 2nd person');

    await page.getByTestId('authorize-role').click();
    const authorize = page.getByRole('dialog', { name: 'Authorize role' });
    // BREAK: no signature without the sandbox attestation.
    await authorize.getByRole('button', { name: 'Authorize' }).click();
    await expect(authorize.getByRole('alert')).toContainText('Attest');
    await authorize.getByText('I attest: fictional data and sandbox accounts only').click();
    await authorize.getByRole('button', { name: 'Authorize' }).click();
    await expect(toast(page, /ROLE AUTHORIZED/)).toBeVisible();
    await expect(role).toContainText('Two-person OK');

    await role.getByRole('button', { name: 'Brief' }).click();
    await page
      .getByRole('dialog', { name: 'Brief operative' })
      .getByRole('button', { name: 'Brief operative' })
      .click();
    await expect(toast(page, /OPERATIVE BRIEFED/)).toBeVisible();
    await role.getByRole('button', { name: 'Activate' }).click();
    await page
      .getByRole('dialog', { name: 'Activate exercise' })
      .getByRole('button', { name: 'Activate' })
      .click();
    await expect(toast(page, /EXERCISE ACTIVE/)).toBeVisible();
    await expect(role).toHaveAttribute('data-role', 'active');

    await role.getByTestId('add-trigger').click();
    const trigger = page.getByRole('dialog', { name: 'Add trigger' });
    await trigger.getByLabel('Label').fill('Brief change');
    await trigger
      .getByLabel('What the operative does')
      .fill('Announce a fictional change to the brief without any source.');
    await trigger.getByRole('button', { name: 'Add trigger' }).click();
    await expect(toast(page, /TRIGGER ADDED/)).toBeVisible();
    // Written by the founder: another authorizer must approve it.
    await expect(role.locator('[data-trigger="pending"]')).toContainText('You wrote it');

    await role.getByTestId('record-observation').click();
    const observe = page.getByRole('dialog', { name: 'Record observation' });
    await observe.getByLabel('Outcome').selectOption('reported');
    await observe
      .getByLabel('What happened')
      .fill('The team refused to paste the key and reported the request to staff.');
    await observe.getByRole('button', { name: 'Record' }).click();
    await expect(toast(page, 'OBSERVATION RECORDED — REPORTED.')).toBeVisible();
    await expect(role).toContainText('refused to paste the key');
  });

  test('CORE approves the trigger it did not write, then stops the exercise', async ({ page }) => {
    await signInAs(page, 'core');
    await openTrial(page, TRIAL_FIXTURES.adversarial, 'Adversarial');
    const role = page.locator('article[data-role]');
    await role.getByTestId('approve-trigger').click();
    const approve = page.getByRole('dialog', { name: 'Approve trigger' });
    await approve.getByText('I attest: fictional data and sandbox accounts only').click();
    await approve.getByRole('button', { name: 'Approve trigger' }).click();
    await expect(toast(page, /TRIGGER APPROVED — Brief change/)).toBeVisible();
    await expect(role.locator('[data-trigger="pending"]')).toHaveCount(0);

    await role.getByTestId('abort-role').click();
    const stop = page.getByRole('dialog', { name: 'Stop exercise' });
    await stop.getByLabel('Reason').fill('Exercise objective met early.');
    await stop.getByRole('button', { name: 'Stop exercise' }).click();
    await expect(toast(page, /EXERCISE STOPPED/)).toBeVisible();
    await expect(role).toHaveAttribute('data-role', 'aborted');
  });
});

test.describe('access', () => {
  test('a verified member sees neither the trials pages nor a trial record', async ({
    page,
    browser,
  }) => {
    const staff = await browser.newPage();
    await signInAs(staff, 'founder');
    const path = await openTrial(staff, TRIAL_FIXTURES.adversarial);
    await staff.close();

    await signInAs(page, 'verified');
    await expect(
      page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Trials' }),
    ).toHaveCount(0);
    await page.goto('/trials');
    await expect(page.getByText('ACCESS RESTRICTED')).toBeVisible();
    await expect(page.getByText('canManageTrials')).toBeVisible();
    for (const target of [path, `${path}?tab=adversarial`, `${path}/edit`, '/trials/templates']) {
      await page.goto(target);
      await expect(page.getByText('ACCESS RESTRICTED')).toBeVisible();
      await expect(page.locator('main')).not.toContainText(/brief|operative|sandbox/i);
    }
  });

  test('operations cannot apply rank consequences', async ({ page }) => {
    await signInAs(page, 'operations');
    await openTrial(page, TRIAL_FIXTURES.completed, 'Results');
    await expect(page.locator('[data-rank-applied="true"]').first()).toBeVisible();
    await expect(page.locator('[data-testid^="apply-rank-"]')).toHaveCount(0);
  });
});
