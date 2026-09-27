import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { signInAs } from './fixtures';

/**
 * /moderation end to end, against the fixtures in moderation-seed.ts.
 * Serial: later tests see the state earlier ones leave behind.
 * With JAVE_SCREENSHOTS=1 the visual pass writes docs/screenshots/moderation-*.png.
 */
test.describe.configure({ mode: 'serial' });

const SCREENSHOT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SAVE = process.env.JAVE_SCREENSHOTS === '1';
const MAX_CAPTURE_HEIGHT = 2200;
const JUN_DISCORD_ID = '110000000000000016';
const FORGED_UUID = '00000000-0000-4000-8000-000000000000';

function caseRow(page: Page, memberName: string) {
  return page.locator('li[data-case]').filter({ hasText: memberName }).getByRole('link').first();
}

function eventRow(page: Page, text: string) {
  return page.locator('li[data-event]').filter({ hasText: text }).getByRole('link').first();
}

test.describe('moderation console', () => {
  test('moderators open cases and see their Discord sync state', async ({ page }) => {
    await signInAs(page, 'moderator');
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Moderation' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Moderation' })).toBeVisible();
    const cases = page.getByRole('list', { name: 'Moderation cases' });
    await expect(cases).toContainText('Jun Park');
    await expect(cases).toContainText('Posted referral links in #general');

    await page.getByRole('combobox', { name: 'Action' }).selectOption('timeout');
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.waitForURL(/action=timeout/);
    await expect(cases.locator('li')).not.toHaveCount(0);
    for (const badge of await cases.locator('li').allInnerTexts()) {
      expect(badge).toMatch(/Timeout/i);
    }

    await caseRow(page, 'Ilya Brenner').click();
    await page.waitForURL(/\/moderation\/cases\/[0-9a-f-]{36}/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/CASE-\d{4}/);
    await expect(page.getByTestId('discord-sync')).toHaveText(/Failed/i);
    await expect(page.getByText("Missing Permissions: the bot's role sits below")).toBeVisible();
    await expect(page.getByRole('list', { name: /timeline/ })).toContainText('By Dev Moderator.');
  });

  test('a case is revoked with a required reason and its quarantine is lifted', async ({
    page,
  }) => {
    await signInAs(page, 'moderator');
    await page.goto('/moderation?action=quarantine&state=live');
    await caseRow(page, 'Priya Raman').click();
    await page.waitForURL(/\/moderation\/cases\//);
    const reference = (await page.getByRole('heading', { level: 1 }).textContent())!.trim();
    await page.getByTestId('revoke-case').click();
    const dialog = page.getByRole('dialog', { name: `Revoke ${reference}` });
    await dialog.getByRole('button', { name: 'Revoke case' }).click();
    // The reason is required: the browser refuses to submit an empty one.
    await expect(dialog).toBeVisible();
    await dialog
      .getByLabel('Reason')
      .fill('Account recovered; the phishing DMs came from a stolen token.');
    await dialog.getByRole('button', { name: 'Revoke case' }).click();
    await expect(
      page.getByText(new RegExp(`CASE REVOKED — ${reference} — lifted through CASE-\\d{4}\\.`)),
    ).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('revoke-case')).toBeHidden();
    await expect(
      page.getByText('Account recovered; the phishing DMs came from a stolen token.'),
    ).toBeVisible();

    await page.goto('/moderation?action=release');
    await expect(page.getByRole('list', { name: 'Moderation cases' })).toContainText(
      `${reference} revoked`,
    );
  });

  test('security events are triaged: acknowledge, then dismiss', async ({ page }) => {
    await signInAs(page, 'moderator');
    await page.goto('/moderation?tab=security');
    const events = page.getByRole('list', { name: 'Security events' });
    await expect(events.getByRole('meter').first()).toBeVisible();
    await expect(events).toContainText('Member report');
    await expect(events).toContainText('guaranteed trial pass');
    await expect(events).not.toContainText('arxiv-mirror.example');

    await eventRow(page, 'Member report').click();
    await page.waitForURL(/\/moderation\/security\/[0-9a-f-]{36}/);
    const reference = (await page.getByRole('heading', { level: 1 }).textContent())!.trim();
    await expect(page.getByTestId('evidence-excerpt')).toContainText(
      'DM me for a guaranteed trial pass',
    );
    await expect(page.getByTestId('event-status')).toHaveText(/Open/i);

    await page.getByTestId('review-acknowledged').click();
    const ack = page.getByRole('dialog', { name: `Acknowledge ${reference}` });
    await ack.getByLabel('Note').fill('Asked Jun for context in a ticket.');
    await ack.getByRole('button', { name: 'Acknowledge' }).click();
    await expect(page.getByText(`${reference} — ACKNOWLEDGED.`)).toBeVisible();
    await expect(page.getByTestId('event-status')).toHaveText(/Acknowledged/i);
    await expect(page.getByTestId('review-acknowledged')).toHaveCount(0);

    await page.getByTestId('review-dismissed').click();
    await page
      .getByRole('dialog', { name: `Dismiss ${reference}` })
      .getByRole('button', { name: 'Dismiss' })
      .click();
    await expect(page.getByText(`${reference} — DISMISSED.`)).toBeVisible();
    await expect(page.getByTestId('event-status')).toHaveText(/Dismissed/i);
    await expect(page.locator('[data-testid^="review-"]')).toHaveCount(0);

    await page.goto('/moderation?tab=security&view=dismissed');
    await expect(events).toContainText(reference);
    await expect(events).toContainText('arxiv-mirror.example');
  });

  test('member lookup finds a record by name and by Discord ID', async ({ page }) => {
    await signInAs(page, 'moderator');
    await page.goto('/moderation?tab=lookup');
    await expect(page.getByText('LOOK UP A MEMBER')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Discord ID, handle or name' }).fill('Jun');
    await page.getByRole('button', { name: 'Look up' }).click();
    await page
      .getByRole('list', { name: 'Matching members' })
      .getByRole('link', { name: /Jun Park/ })
      .click();
    await page.waitForURL(new RegExp(`q=${JUN_DISCORD_ID}`));
    const record = page.getByRole('region', { name: 'Moderation record of Jun Park' });
    await expect(record).toContainText('WARNINGS');
    await expect(record.getByRole('list', { name: 'Cases about Jun Park' })).toContainText(
      'Posted referral links',
    );
    await expect(record.getByRole('list', { name: 'Security events' })).toContainText(
      'Member report',
    );

    await page.goto('/moderation?tab=lookup&q=199999999999999999');
    await expect(page.getByText('NO RECORD')).toBeVisible();
  });

  test('raid mode: moderators read it but cannot switch it', async ({ page }) => {
    await signInAs(page, 'moderator');
    await page.goto('/moderation?tab=raid');
    await expect(page.getByTestId('raid-state')).toHaveText(/Off/i);
    await expect(page.getByText('Switching requires')).toBeVisible();
    await expect(page.getByTestId('raid-on')).toHaveCount(0);
  });

  test('core switches raid mode on and off, audited', async ({ page }) => {
    await signInAs(page, 'core');
    await page.goto('/moderation?tab=raid');
    await page.getByTestId('raid-on').click();
    const on = page.getByRole('dialog', { name: 'Switch raid mode on' });
    await on.getByLabel('Reason').fill('Join burst from a known raid server.');
    await on.getByRole('button', { name: 'Switch on' }).click();
    await expect(
      page.getByText('RAID MODE — ON — new joins are quarantined for review.'),
    ).toBeVisible();
    await expect(page.getByTestId('raid-state')).toHaveText(/On/i);

    await page.getByTestId('raid-off').click();
    const off = page.getByRole('dialog', { name: 'Switch raid mode off' });
    await off.getByLabel('Reason').fill('Burst over; invites rotated.');
    await off.getByRole('button', { name: 'Switch off' }).click();
    await expect(page.getByTestId('raid-state')).toHaveText(/Off/i);

    await page.goto('/audit?action=security.raid_mode_changed');
    await expect(page.locator('[data-action="security.raid_mode_changed"]')).toHaveCount(2);
  });

  test('BREAK: members get ACCESS RESTRICTED and no navigation entry', async ({ page }) => {
    await signInAs(page, 'verified');
    await expect(
      page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Moderation' }),
    ).toHaveCount(0);
    for (const path of [
      '/moderation',
      '/moderation?tab=security',
      `/moderation/cases/${FORGED_UUID}`,
      `/moderation/security/${FORGED_UUID}`,
    ]) {
      await page.goto(path);
      await expect(page.getByText('ACCESS RESTRICTED'), path).toBeVisible();
      await expect(page.locator('li[data-case], li[data-event]')).toHaveCount(0);
    }
    // Streaming (loading.tsx) sends 200 before the not-found boundary renders.
    await page.goto('/moderation/cases/not-a-case');
    await expect(page.getByText('NOT FOUND')).toBeVisible();
  });

  test('BREAK: hostile filter values are ignored, never executed', async ({ page }) => {
    await signInAs(page, 'moderator');
    let dialogs = 0;
    page.on('dialog', async (dialog) => {
      dialogs += 1;
      await dialog.dismiss();
    });
    await page.goto(
      `/moderation?q=${encodeURIComponent("1'; drop table mod_cases; --")}&action=${encodeURIComponent('<script>alert(1)</script>')}&offset=-9`,
    );
    await expect(page.getByText('A filter was not understood and was ignored.')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Moderation cases' })).toContainText('Jun Park');
    await page.goto(
      `/moderation?tab=lookup&q=${encodeURIComponent('<img src=x onerror=alert(1)>')}`,
    );
    await expect(page.getByText('NO MATCHING MEMBERS')).toBeVisible();
    await page.goto(`/moderation/security/${FORGED_UUID}`);
    expect(dialogs).toBe(0);
  });
});

/** Screenshots at 1440 and 390; 375 (the narrowest supported phone) is checked for overflow only. */
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, capture: true },
  { name: 'mobile', width: 390, height: 844, capture: true },
  { name: 'narrow', width: 375, height: 812, capture: false },
] as const;

async function detailPath(
  page: Page,
  list: string,
  row: (page: Page) => ReturnType<typeof caseRow>,
) {
  await page.goto(list);
  return (await row(page).getAttribute('href'))!;
}

for (const viewport of VIEWPORTS) {
  test.describe(`moderation visual (${viewport.width}px)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('pages fit the viewport', async ({ page }) => {
      test.setTimeout(180_000);
      await signInAs(page, 'founder');
      const shots: { name: string; path: string }[] = [
        { name: 'moderation-cases', path: '/moderation' },
        { name: 'moderation-security', path: '/moderation?tab=security' },
        { name: 'moderation-lookup', path: `/moderation?tab=lookup&q=${JUN_DISCORD_ID}` },
        { name: 'moderation-raid', path: '/moderation?tab=raid' },
        {
          name: 'moderation-case',
          path: await detailPath(page, '/moderation?action=timeout', (p) =>
            caseRow(p, 'Ilya Brenner'),
          ),
        },
        {
          name: 'moderation-event',
          path: await detailPath(page, '/moderation?tab=security', (p) =>
            eventRow(p, 'Noor Haddad'),
          ),
        },
      ];
      for (const shot of shots) {
        await page.goto(shot.path);
        await page.waitForLoadState('networkidle');
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(
          overflow,
          `${shot.name} scrolls horizontally at ${viewport.width}px`,
        ).toBeLessThanOrEqual(0);
        if (SAVE && viewport.capture) {
          const height = await page.evaluate(() => document.documentElement.scrollHeight);
          await page.screenshot({
            path: `${SCREENSHOT_DIR}${shot.name}-${viewport.width}.png`,
            clip: {
              x: 0,
              y: 0,
              width: viewport.width,
              height: Math.min(height, MAX_CAPTURE_HEIGHT),
            },
            fullPage: true,
            animations: 'disabled',
            caret: 'hide',
          });
        }
      }
    });
  });
}
