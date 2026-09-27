import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { type Persona, signInAs } from './fixtures';
import { REFERRAL_FIXTURES } from './seed-referrals';

/**
 * Analytics and referrals: staff flows, capability gates and the visual
 * gauntlet for these pages. Screenshots run first, before the flows below
 * change the fixtures. With JAVE_SCREENSHOTS=1 they are written to
 * docs/screenshots/.
 */
test.describe.configure({ mode: 'serial' });

const SCREENSHOT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SAVE = process.env.JAVE_SCREENSHOTS === '1';
/** Committed captures are capped; JAVE_CAPTURE_HEIGHT raises the cap for a full-page review. */
const MAX_CAPTURE_HEIGHT = Number(process.env.JAVE_CAPTURE_HEIGHT) || 2600;
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

async function campaignPath(page: Page, key: string): Promise<string> {
  await page.goto('/referrals?tab=campaigns');
  const href = await page
    .getByRole('table', { name: 'Campaigns' })
    .getByRole('link', { name: new RegExp(key) })
    .getAttribute('href');
  return href!;
}

const SHOTS: readonly {
  name: string;
  persona: Persona;
  path: string | ((page: Page) => Promise<string>);
  /** The light theme (opt-in via data-theme): charts must hold up in both. */
  light?: boolean;
  /** Capture the whole page, however tall (the analytics page is long by design). */
  full?: boolean;
}[] = [
  { name: 'analytics', persona: 'operations', path: '/analytics', full: true },
  { name: 'analytics-light', persona: 'operations', path: '/analytics', light: true, full: true },
  { name: 'analytics-7d', persona: 'operations', path: '/analytics?range=7' },
  { name: 'referrals', persona: 'core', path: '/referrals' },
  { name: 'referrals-campaigns', persona: 'core', path: '/referrals?tab=campaigns' },
  { name: 'referrals-review', persona: 'core', path: '/referrals?tab=review' },
  { name: 'referrals-invites', persona: 'core', path: '/referrals?tab=invites' },
  {
    name: 'referrals-campaign',
    persona: 'core',
    path: (page) => campaignPath(page, REFERRAL_FIXTURES.activeCampaign),
  },
  { name: 'overview-health', persona: 'operations', path: '/overview' },
  { name: 'analytics-restricted', persona: 'member', path: '/analytics' },
];

test.describe('visual gauntlet', () => {
  for (const viewport of VIEWPORTS) {
    test(`pages at ${viewport.width}px never scroll sideways`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.setViewportSize(viewport);
      let signedIn: Persona | null = null;
      for (const shot of SHOTS) {
        if (signedIn !== shot.persona) {
          await page.context().clearCookies();
          await signInAs(page, shot.persona);
          signedIn = shot.persona;
        }
        const path = typeof shot.path === 'string' ? shot.path : await shot.path(page);
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        if (shot.light) {
          await page.evaluate(() => {
            document.documentElement.dataset.theme = 'light';
          });
        }
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(
          overflow,
          `${shot.name} scrolls sideways at ${viewport.width}px`,
        ).toBeLessThanOrEqual(0);
        if (SAVE) {
          const height = await page.evaluate(() => document.documentElement.scrollHeight);
          await page.screenshot({
            path: `${SCREENSHOT_DIR}${shot.name}-${viewport.width}.png`,
            clip: {
              x: 0,
              y: 0,
              width: viewport.width,
              height: shot.full ? height : Math.min(height, MAX_CAPTURE_HEIGHT),
            },
            fullPage: true,
            animations: 'disabled',
            caret: 'hide',
          });
        }
      }
    });
  }
});

test.describe('analytics', () => {
  test('operations staff read organizational health and switch the range', async ({ page }) => {
    await signInAs(page, 'operations');
    await page.getByRole('link', { name: 'Analytics' }).first().click();
    await page.waitForURL('**/analytics');
    await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
    const kpis = page.getByRole('region', { name: 'Health indicators' });
    for (const label of [
      'MEMBERS PRESENT',
      'D30 RETENTION',
      'TRIAL PASS RATE',
      'SLA BREACH RATE',
    ]) {
      await expect(kpis.getByText(label)).toBeVisible();
    }
    for (const section of ['Members', 'Pipeline', 'Outcomes over time', 'Support and safety']) {
      await expect(
        page.getByRole('heading', { level: 2, name: section, exact: true }),
      ).toBeVisible();
    }
    await expect(page.getByRole('heading', { level: 2, name: 'JAVELIN progress' })).toBeVisible();

    const range = page.getByRole('navigation', { name: 'Time range' });
    await expect(range.getByRole('link', { name: 'Last 30 days' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await range.getByRole('link', { name: 'Last 7 days' }).click();
    await page.waitForURL(/range=7/);
    await expect(range.getByRole('link', { name: 'Last 7 days' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByText(/\d+ of 7 days captured/)).toBeVisible();
  });

  test('charts carry a keyboard readout and a table twin', async ({ page }) => {
    await signInAs(page, 'operations');
    await page.goto('/analytics');
    const chart = page.getByRole('group', { name: /Daily joins and leaves/ });
    await chart.focus();
    await page.keyboard.press('End');
    await expect(
      page.locator('[aria-live="polite"]').filter({ hasText: /joins, \d+ leaves/ }),
    ).toHaveCount(1);
    const flow = page.locator('figure').filter({ hasText: 'Daily flow' });
    await flow.getByText('Show table').click();
    const table = flow.getByRole('table', { name: 'Daily joins and leaves' });
    await expect(table).toBeVisible();
    await expect(table.getByRole('row')).toHaveCount(31);
    // Days the job missed read as missing, never as zero.
    await expect(table.getByRole('row').filter({ hasText: '—' }).first()).toBeVisible();
  });

  test('BREAK: members get ACCESS RESTRICTED and no analytics navigation', async ({ page }) => {
    await signInAs(page, 'member');
    await expect(page.getByRole('link', { name: 'Analytics' })).toHaveCount(0);
    await expect(page.getByText('Health · last 30 days')).toHaveCount(0);
    await page.goto('/analytics');
    await expect(page.getByText('ACCESS RESTRICTED')).toBeVisible();
    await expect(page.getByText('canViewAnalytics')).toBeVisible();
    await page.goto('/referrals');
    await expect(page.getByText('ACCESS RESTRICTED')).toBeVisible();
    await page.goto('/referrals/campaigns/00000000-0000-4000-8000-000000000000');
    await expect(page.getByText('ACCESS RESTRICTED')).toBeVisible();
  });

  test('the overview carries a health strip for analytics staff', async ({ page }) => {
    await signInAs(page, 'operations');
    await expect(page.getByText('Health · last 30 days')).toBeVisible();
    await page.getByRole('link', { name: 'Analytics' }).last().click();
    await page.waitForURL(/\/analytics\?range=30/);
  });
});

test.describe('referrals', () => {
  test('operations staff see funnels and flags but no controls', async ({ page }) => {
    await signInAs(page, 'operations');
    await page.goto('/referrals');
    await expect(page.getByRole('list', { name: 'Server-wide funnel' })).toContainText('VALID');
    const inviters = page.getByRole('table', { name: 'Inviters' });
    await expect(inviters.getByText('Mara Voss')).toBeVisible();
    await expect(page.getByTestId('new-campaign')).toHaveCount(0);
    await page.goto('/referrals?tab=review');
    const queue = page.getByRole('list', { name: 'Referrals awaiting review' });
    await expect(queue.getByText('Nova Reyes', { exact: true })).toBeVisible();
    await expect(queue.getByRole('button')).toHaveCount(0);
  });

  test('core staff create, edit, attach, detach, deactivate and delete a campaign', async ({
    page,
  }) => {
    await signInAs(page, 'core');
    await page.goto('/referrals?tab=campaigns');
    await page.getByTestId('new-campaign').click();
    const dialog = page.getByRole('dialog', { name: 'New campaign' });
    await dialog.getByLabel('Key').fill('Bad Key!');
    await dialog.getByLabel('Name').fill('Winter build week');
    await dialog.getByRole('button', { name: 'Create campaign' }).click();
    await expect(
      dialog.getByText('use 2–48 lowercase letters, digits or dashes', { exact: true }),
    ).toBeVisible();
    await dialog.getByLabel('Key').fill('winter-build');
    await dialog.getByLabel('Ends (UTC, inclusive)').fill('2020-01-01');
    await dialog.getByLabel('Starts (UTC)').fill('2020-02-01');
    await dialog.getByRole('button', { name: 'Create campaign' }).click();
    await expect(dialog.getByText('endsAt must be after startsAt', { exact: true })).toBeVisible();
    await dialog.getByLabel('Starts (UTC)').fill('');
    await dialog.getByLabel('Ends (UTC, inclusive)').fill('');
    await dialog.getByRole('button', { name: 'Create campaign' }).click();
    await expect(page.getByText('CAMPAIGN CREATED — winter-build.')).toBeVisible();
    await expect(dialog).toBeHidden();

    await page.getByRole('link', { name: /Winter build week/ }).click();
    await page.waitForURL(/\/referrals\/campaigns\/[0-9a-f-]{36}/);
    await expect(page.getByRole('heading', { level: 1, name: 'Winter build week' })).toBeVisible();

    const settings = page.getByRole('form', { name: 'Campaign settings' });
    await settings.getByLabel('Name').fill('Winter build sprint');
    await settings.getByRole('button', { name: 'Save campaign' }).click();
    await expect(page.getByText('CAMPAIGN SAVED — winter-build.')).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Winter build sprint' }),
    ).toBeVisible();

    const attach = page.getByRole('form', { name: 'Attach an invite' });
    await attach.getByLabel('Attach an invite').selectOption('theoops');
    await attach.getByRole('button', { name: 'Attach' }).click();
    await expect(page.getByText(/INVITE ATTACHED — theoops/)).toBeVisible();
    const attached = page.getByRole('table', { name: 'Attached invites' });
    await expect(attached.getByText('theoops')).toBeVisible();

    await page.getByTestId('detach-theoops').click();
    await page
      .getByRole('dialog', { name: 'Detach theoops' })
      .getByRole('button', { name: 'Detach invite' })
      .click();
    await expect(page.getByText(/INVITE DETACHED — theoops/)).toBeVisible();
    await expect(attached.getByText('NO INVITES ATTACHED')).toBeVisible();

    await page.getByTestId('campaign-active-toggle').click();
    await page
      .getByRole('dialog', { name: 'Deactivate campaign' })
      .getByRole('button', { name: 'Deactivate' })
      .click();
    await expect(page.getByText(/CAMPAIGN DEACTIVATED — winter-build/)).toBeVisible();
    await expect(page.getByText('INACTIVE', { exact: true }).first()).toBeVisible();

    await page.getByTestId('delete-campaign').click();
    await page
      .getByRole('dialog', { name: 'Delete campaign' })
      .getByRole('button', { name: 'Delete campaign' })
      .click();
    await page.waitForURL(/tab=campaigns&notice=campaign-deleted/);
    await expect(page.getByText('CAMPAIGN DELETED.')).toBeVisible();
    await expect(page.getByRole('link', { name: /Winter build sprint/ })).toHaveCount(0);
  });

  test('BREAK: a campaign that credited joins offers no delete, only deactivation', async ({
    page,
  }) => {
    await signInAs(page, 'core');
    await page.goto(await campaignPath(page, REFERRAL_FIXTURES.activeCampaign));
    await expect(
      page.getByRole('heading', { level: 1, name: 'Autumn trials recruitment' }),
    ).toBeVisible();
    await expect(page.getByTestId('delete-campaign')).toHaveCount(0);
    await expect(page.getByText(/Deactivate it instead: its history stays intact/)).toBeVisible();
    await expect(page.getByTestId('campaign-active-toggle')).toHaveText('Deactivate');
  });

  test('core staff clear a false positive and invalidate an inflated referral', async ({
    page,
  }) => {
    await signInAs(page, 'core');
    await page.goto('/referrals?tab=review');
    const queue = page.getByRole('list', { name: 'Referrals awaiting review' });
    const [falsePositive, inflated] = REFERRAL_FIXTURES.flaggedInvitees;

    const first = queue.getByRole('listitem').filter({ hasText: falsePositive });
    await first.getByRole('button', { name: 'Clear flags' }).click();
    const clear = page.getByRole('dialog', { name: 'Clear flags' });
    await clear.getByRole('button', { name: 'Clear flags' }).click();
    await expect(clear).toBeVisible(); // the reason is required
    await clear.getByLabel('Reason').fill('Joined with a study group; verified in voice.');
    await clear.getByRole('button', { name: 'Clear flags' }).click();
    await expect(page.getByText('FLAGS CLEARED — the referral can become VALID.')).toBeVisible();

    const second = queue.getByRole('listitem').filter({ hasText: inflated });
    await second.getByRole('button', { name: 'Invalidate' }).click();
    const invalidate = page.getByRole('dialog', { name: 'Invalidate referral' });
    await invalidate.getByLabel('Reason').fill('Look-alike account of an existing invitee.');
    await invalidate.getByRole('button', { name: 'Invalidate' }).click();
    await expect(page.getByText('REFERRAL INVALIDATED — removed from every count.')).toBeVisible();
    await expect(page.getByText('QUEUE CLEAR')).toBeVisible();
  });

  // Console pages stream behind a loading boundary, so notFound() renders the
  // NOT FOUND view (noindex) under the already-sent 200: assert the view.
  test('BREAK: a forged campaign id reads NOT FOUND, never an error page', async ({ page }) => {
    await signInAs(page, 'core');
    for (const id of ['00000000-0000-4000-8000-000000000000', 'not-a-uuid', '%27%3B--']) {
      await page.goto(`/referrals/campaigns/${id}`);
      await expect(page.getByText('NOT FOUND')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
      await expect(page.getByTestId('campaign-active-toggle')).toHaveCount(0);
    }
    await page.goto('/referrals?tab=../../settings&offset=-5&campaign=zzz');
    await expect(page.getByRole('table', { name: 'Inviters' })).toBeVisible();
  });
});
