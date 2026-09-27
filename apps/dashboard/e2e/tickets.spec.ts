import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { type Persona, signInAs } from './fixtures';
import { TICKET_FIXTURES } from './tickets-seed';

/**
 * Tickets end to end, against the seeded support queue (e2e/tickets-seed.ts):
 * staff triage, the full handler lifecycle, bulk actions, the requester's
 * view and transcript exports, access refusals, and the visual gauntlet.
 */
test.describe.configure({ mode: 'serial' });

const SCREENSHOT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SAVE = process.env.JAVE_SCREENSHOTS === '1';
const MAX_CAPTURE_HEIGHT = 2200;
const TICKET_PATH = /\/tickets\/[0-9a-f-]{36}$/;
const INTERNAL_NOTE = 'Second evaluator is Theo; nudged him.';
/** A well-formed user id that is not the viewer's. */
const FOREIGN_USER_ID = '0b5a3f0e-8d1c-4f47-9e7a-2d6c1b9f4a10';

function toasts(page: Page): Locator {
  return page.getByRole('list', { name: 'Notifications' });
}

function queueRows(page: Page): Locator {
  return page.getByRole('table', { name: 'Tickets' }).locator('tbody tr');
}

/** Opens a ticket from the queue by its subject; returns its path. */
async function openTicket(page: Page, subject: string): Promise<string> {
  await page.goto(`/tickets?status=all&q=${encodeURIComponent(subject)}`);
  await page.getByRole('link', { name: new RegExp(subject) }).click();
  await page.waitForURL(TICKET_PATH);
  return new URL(page.url()).pathname;
}

async function confirmDialog(
  page: Page,
  trigger: string,
  fill?: (dialog: Locator) => Promise<unknown>,
) {
  await page.getByTestId(trigger).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  if (fill) await fill(dialog);
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toBeHidden();
}

const paths: Record<string, string> = {};

test.describe('staff', () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, 'moderator');
  });

  test('the queue: live counts, deadlines first, calm SLA readouts and filters', async ({
    page,
  }) => {
    await page.goto('/tickets');
    const stats = page.locator('dl[aria-label="Ticket statistics"]');
    for (const label of ['ACTIVE', 'UNASSIGNED', 'ASSIGNED TO YOU', 'SLA MISSED']) {
      await expect(stats.getByText(label, { exact: true })).toBeVisible();
    }
    // Plain handlers do not see the 30-day record (canViewAnalytics / canManageTickets).
    await expect(page.locator('[data-stat="breach-rate"]')).toHaveCount(0);

    const rows = queueRows(page);
    await expect(rows.first()).toContainText(TICKET_FIXTURES.overdue);
    await expect(rows.first().locator('[data-sla-tone="danger"]')).toHaveText('Missed');
    const dueSoon = page.locator('tr', { hasText: TICKET_FIXTURES.dueSoon });
    await expect(dueSoon.locator('[data-sla-tone="warning"]')).toContainText('Due in');
    const answered = page.locator('tr', { hasText: TICKET_FIXTURES.claimed });
    await expect(answered.locator('[data-sla-tone="success"]')).toContainText('Met in');
    // Closed tickets are not in the active queue.
    await expect(page.getByText(TICKET_FIXTURES.closed)).toHaveCount(0);

    await page
      .getByRole('navigation', { name: 'Queue views' })
      .getByRole('link', { name: 'SLA missed' })
      .click();
    await page.waitForURL(/sla=missed/);
    await expect(queueRows(page)).toHaveCount(1);
    await expect(queueRows(page).first()).toContainText(TICKET_FIXTURES.overdue);

    await page.goto('/tickets');
    await page.getByRole('combobox', { name: 'Priority' }).selectOption('high');
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.waitForURL(/priority=high/);
    await expect(queueRows(page)).toHaveCount(2);

    await page.goto('/tickets?status=closed');
    await expect(queueRows(page)).toHaveCount(1);
    await expect(queueRows(page).first()).toContainText(TICKET_FIXTURES.closed);

    await page.goto('/tickets?q=nothing-matches-this');
    await expect(page.getByText('NO MATCHES')).toBeVisible();
    await page.getByRole('link', { name: 'Clear filters' }).click();
    await expect(queueRows(page).first()).toBeVisible();
  });

  test("a requester's history: from their ticket to every ticket they opened", async ({ page }) => {
    await openTicket(page, TICKET_FIXTURES.requester);
    const link = page.getByTestId('requester-history');
    const name = (await link.textContent())?.trim() ?? '';
    expect(name.length).toBeGreaterThan(0);
    await link.click();
    await page.waitForURL(/opener=[0-9a-f-]{36}/);
    const url = new URL(page.url());
    paths.history = `${url.pathname}${url.search}`;

    const bar = page.getByTestId('opener-filter');
    await expect(bar).toContainText(/opened by/i);
    await expect(bar).toContainText(name);
    await expect(queueRows(page)).toHaveCount(1);
    await expect(queueRows(page).first()).toContainText(TICKET_FIXTURES.requester);
    // One member's history is not a triage view.
    await expect(
      page.getByRole('navigation', { name: 'Queue views' }).locator('[aria-current="page"]'),
    ).toHaveCount(0);

    await bar.getByRole('link', { name: 'All requesters' }).click();
    await page.waitForURL((next) => !next.searchParams.has('opener'));
    await expect(page.getByTestId('opener-filter')).toHaveCount(0);
    await expect(queueRows(page).filter({ hasText: TICKET_FIXTURES.overdue })).toHaveCount(1);
  });

  test('a handler claims, notes, prioritises, waits, resumes, closes and reopens', async ({
    page,
  }) => {
    paths.unassigned = await openTicket(page, TICKET_FIXTURES.unassigned);
    await expect(page.locator('[data-ticket-status="open"]').first()).toBeVisible();

    await page.getByTestId('claim-ticket').click();
    await expect(toasts(page)).toContainText('TICKET CLAIMED');
    await expect(page.locator('[data-ticket-status="claimed"]').first()).toBeVisible();
    await expect(page.getByTestId('claim-ticket')).toHaveCount(0);

    const note = 'Reproduced with a 12 MB PDF. Limit is 10 MB — the error should say so.';
    const noteForm = page.getByRole('form', { name: 'Add internal note' });
    await noteForm.getByLabel('Note').fill(note);
    await noteForm.getByRole('button', { name: 'Add internal note' }).click();
    const internal = page.locator('[data-message-kind="internal"]', { hasText: note });
    await expect(internal).toBeVisible();
    await expect(internal).toContainText('Internal note · staff only');

    await confirmDialog(page, 'set-priority', (dialog) =>
      dialog.getByLabel('Priority').selectOption('high'),
    );
    await expect(toasts(page)).toContainText('PRIORITY SET');
    await expect(page.locator('[data-ticket-priority="high"]').first()).toBeVisible();

    await confirmDialog(page, 'set-waiting', (dialog) =>
      dialog
        .getByLabel('What the requester needs to do')
        .fill('Send the exact file size and type.'),
    );
    await expect(page.locator('[data-ticket-status="waiting"]').first()).toBeVisible();

    await page.getByTestId('resume-ticket').click();
    await expect(toasts(page)).toContainText('TICKET RESUMED');
    await expect(page.locator('[data-ticket-status="claimed"]').first()).toBeVisible();

    await confirmDialog(page, 'close-ticket', (dialog) =>
      dialog.getByLabel('Reason').fill('Upload limit raised to 25 MB.'),
    );
    await expect(page.getByText('Upload limit raised to 25 MB.').first()).toBeVisible();
    await expect(page.locator('[data-ticket-status="closed"]').first()).toBeVisible();

    await confirmDialog(page, 'reopen-ticket', (dialog) =>
      dialog.getByLabel('Reason').fill('Still failing for DOCX files.'),
    );
    await expect(page.locator('[data-ticket-status="claimed"]').first()).toBeVisible();

    const timeline = page.getByRole('list', { name: 'Ticket timeline' });
    for (const entry of [
      'Claimed',
      'Internal note added',
      'Waiting on requester',
      'Closed',
      'Reopened',
    ]) {
      await expect(timeline.getByText(entry, { exact: true }).first()).toBeVisible();
    }
  });

  test('bulk: one confirmation, per-ticket results', async ({ page }) => {
    await page.goto('/tickets?assignee=none');
    const table = page.getByRole('table', { name: 'Tickets' });
    // #0001 (dashboard fixture) and #0008 (calendar links): NORMAL and LOW.
    await table.getByLabel('Select #0001').check();
    await table.getByLabel('Select #0008').check();
    await expect(page.getByTestId('bulk-count')).toHaveText('2 selected');
    const bulk = page.getByRole('region', { name: 'Bulk actions' });
    await bulk.getByRole('button', { name: 'Priority' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Priority').selectOption('high');
    await dialog.getByRole('button', { name: 'Set priority' }).click();
    await expect(toasts(page)).toContainText('SET TO HIGH 2 OF 2');
    // The selection survives the refresh (claim them next, or clear it).
    await expect(page.getByTestId('bulk-count')).toHaveText('2 selected');
    await expect(
      page
        .locator('tr', { hasText: '#0008' })
        .locator('[data-ticket-priority="high"]')
        .filter({ visible: true }),
    ).toBeVisible();
    await bulk.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByTestId('bulk-count')).toHaveCount(0);
  });

  test('BREAK: a bulk close of a colleague’s ticket is refused per ticket, in the dialog', async ({
    page,
  }) => {
    await page.goto('/tickets');
    const table = page.getByRole('table', { name: 'Tickets' });
    // #0002 is Ren Takeda's: a plain handler may not close it.
    await table.getByLabel('Select #0002').check();
    const bulk = page.getByRole('region', { name: 'Bulk actions' });
    await bulk.getByRole('button', { name: 'Close' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Reason').fill('Closing a colleague’s ticket.');
    await dialog.getByRole('button', { name: 'Close 1' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Nothing closed.');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.reload();
    await expect(
      page
        .locator('tr', { hasText: '#0002' })
        .locator('[data-ticket-status="claimed"]')
        .filter({ visible: true }),
    ).toBeVisible();
  });

  test('the AI summary is labelled, stored and refreshed through JAVE AI', async ({ page }) => {
    paths.claimed = await openTicket(page, TICKET_FIXTURES.claimed);
    const panel = page.getByTestId('ai-summary');
    await expect(panel.getByText('AI-GENERATED')).toBeVisible();
    await expect(panel).toContainText('exits with code 137');
    // The e2e deployment runs the MOCK / DEVELOPMENT ONLY provider, so a refresh
    // is offered (a disabled provider reads DISABLED, covered by unit tests).
    // Nothing was said since the stored summary: core keeps it, no model call.
    await expect(panel).not.toContainText('DISABLED');
    await panel.getByTestId('generate-summary').click();
    await expect(toasts(page)).toContainText('SUMMARY CURRENT');
    await expect(panel).toContainText('exits with code 137');
  });

  test('BREAK: a plain handler cannot export transcripts or act on a colleague’s ticket', async ({
    page,
  }) => {
    await page.goto(paths.claimed!);
    await expect(page.getByRole('form', { name: 'Export transcript' })).toHaveCount(0);
    for (const control of ['transfer-ticket', 'set-priority', 'close-ticket', 'unclaim-ticket']) {
      await expect(page.getByTestId(control)).toHaveCount(0);
    }
    const origin = new URL(page.url()).origin;
    const response = await page.request.post(`${paths.claimed}/transcript`, {
      form: { format: 'html' },
      headers: { origin },
    });
    expect(response.status()).toBe(404);
  });
});

test.describe('requester', () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, 'verified');
  });

  test('sees only their own tickets, never internal notes or staff data', async ({ page }) => {
    await page.goto('/tickets');
    await expect(queueRows(page)).toHaveCount(1);
    await expect(queueRows(page).first()).toContainText(TICKET_FIXTURES.requester);
    await expect(page.locator('dl[aria-label="Ticket statistics"]')).toHaveCount(0);

    paths.own = await openTicket(page, TICKET_FIXTURES.requester);
    await expect(page.getByText('Results publish after the second evaluator')).toBeVisible();
    await expect(page.getByText(INTERNAL_NOTE)).toHaveCount(0);
    await expect(page.locator('[data-message-kind="internal"]')).toHaveCount(0);
    await expect(page.getByTestId('ai-summary')).toHaveCount(0);
    await expect(page.locator('[data-sla-tone]')).toHaveCount(0);
    await expect(page.getByTestId('claim-ticket')).toHaveCount(0);
    await expect(page.getByTestId('close-ticket')).toBeVisible();
    await expect(page.getByLabel('Include internal notes')).toHaveCount(0);
    await expect(page.getByTestId('requester-history')).toHaveCount(0);
  });

  test("BREAK: the opener filter never widens a member's list", async ({ page }) => {
    await page.goto(`/tickets?opener=${FOREIGN_USER_ID}&status=all`);
    await expect(page.getByTestId('opener-filter')).toHaveCount(0);
    await expect(queueRows(page)).toHaveCount(1);
    await expect(queueRows(page).first()).toContainText(TICKET_FIXTURES.requester);
  });

  test('exports their own transcript, without internal notes', async ({ page }) => {
    await page.goto(paths.own!);
    const download = page.waitForEvent('download');
    await page.getByTestId('export-transcript').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^ticket-\d{4}\.html$/);
    const html = await readFile((await file.path())!, 'utf8');
    expect(html).toContain(TICKET_FIXTURES.requester);
    expect(html).not.toContain(INTERNAL_NOTE);
    expect(html).toContain("default-src 'none'");
    await expect(toasts(page)).toContainText('TRANSCRIPT EXPORTED');
    // Audited, but staff bookkeeping: the requester's timeline does not list exports.
    await page.reload();
    await expect(page.getByRole('list', { name: 'Ticket timeline' })).toBeVisible();
    await expect(page.getByText('Transcript exported')).toHaveCount(0);
  });

  test('BREAK: internal exports, forged origins and other tickets are refused', async ({
    page,
  }) => {
    const origin = new URL(page.url()).origin;
    const internal = await page.request.post(`${paths.own}/transcript`, {
      form: { format: 'markdown', internal: 'on' },
      headers: { origin },
    });
    expect(internal.status()).toBe(403);

    const forged = await page.request.post(`${paths.own}/transcript`, {
      form: { format: 'html' },
      headers: { origin: 'https://evil.example' },
    });
    expect(forged.status()).toBe(403);

    const viaGet = await page.request.get(`${paths.own}/transcript`);
    expect(viaGet.status()).toBe(405);

    // Someone else's ticket reads as "not found", exactly like a missing one.
    // (The page streams behind its loading state, so both answer with the same status.)
    const missing = await page.goto('/tickets/00000000-0000-4000-8000-000000000000');
    await expect(page.getByText('NOT FOUND')).toBeVisible();
    const other = await page.goto(paths.claimed!);
    expect(other?.status()).toBe(missing?.status());
    await expect(page.getByText('NOT FOUND')).toBeVisible();
    await expect(page.getByText(TICKET_FIXTURES.claimed)).toHaveCount(0);
    const otherExport = await page.request.post(`${paths.claimed}/transcript`, {
      form: { format: 'html' },
      headers: { origin },
    });
    expect(otherExport.status()).toBe(404);
  });
});

test.describe('manager', () => {
  test('exports the internal record in Markdown', async ({ page }) => {
    await signInAs(page, 'operations');
    await page.goto(paths.own!);
    await page.getByRole('combobox', { name: 'Format' }).selectOption('markdown');
    await page.getByLabel('Include internal notes').check();
    const download = page.waitForEvent('download');
    await page.getByTestId('export-transcript').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^ticket-\d{4}-internal\.md$/);
    const markdown = await readFile((await file.path())!, 'utf8');
    expect(markdown).toContain('Second evaluator is Theo');
    // Both exports are on the staff timeline: the requester's and this one.
    await page.reload();
    const timeline = page.getByRole('list', { name: 'Ticket timeline' });
    await expect(timeline.getByText('Transcript exported · HTML')).toBeVisible();
    await expect(timeline.getByText('Transcript exported · Markdown')).toBeVisible();
    await expect(timeline.getByText('Including internal notes.')).toBeVisible();
  });
});

test.describe('member', () => {
  test('opens a ticket from the dashboard and lands on it', async ({ page }) => {
    await signInAs(page, 'member');
    await page.goto('/tickets');
    await expect(page.getByText('NO TICKETS')).toBeVisible();
    await page.getByTestId('open-ticket').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Category').selectOption('technical');
    await dialog.getByLabel('Subject').fill('Notifications arrive twice');
    await dialog.getByLabel('Details').fill('Every ticket update reaches my DMs two times.');
    await dialog.getByRole('button', { name: 'Open ticket' }).click();
    await page.waitForURL(TICKET_PATH);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/#\d{4}/);
    await expect(page.getByText('Notifications arrive twice').first()).toBeVisible();
    await expect(page.getByText('Being prepared')).toBeVisible();
    await expect(page.getByText('Every ticket update reaches my DMs two times.')).toBeVisible();
  });
});

interface Shot {
  name: string;
  persona: Persona;
  path: () => string;
}

const SHOTS: readonly Shot[] = [
  { name: 'tickets-queue', persona: 'founder', path: () => '/tickets' },
  { name: 'tickets-history', persona: 'moderator', path: () => paths.history! },
  { name: 'tickets-detail-staff', persona: 'moderator', path: () => paths.claimed! },
  { name: 'tickets-detail-manager', persona: 'operations', path: () => paths.own! },
  { name: 'tickets-empty', persona: 'founder', path: () => '/tickets?q=nothing-matches-this' },
  { name: 'tickets-requester', persona: 'verified', path: () => '/tickets' },
  { name: 'tickets-detail-requester', persona: 'verified', path: () => paths.own! },
];

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

for (const viewport of VIEWPORTS) {
  test.describe(`visual ${viewport.width}px`, () => {
    test.use({ viewport });
    test('ticket pages never scroll sideways', async ({ page }) => {
      test.setTimeout(180_000);
      let current: Persona | null = null;
      for (const shot of SHOTS) {
        if (shot.persona !== current) {
          await page.context().clearCookies();
          await signInAs(page, shot.persona);
          current = shot.persona;
        }
        await page.goto(shot.path());
        await page.waitForLoadState('networkidle');
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow, `${shot.name} scrolls horizontally`).toBeLessThanOrEqual(0);
        if (SAVE) {
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
