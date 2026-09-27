import { expect, type Page, test } from '@playwright/test';
import { signInAs } from './fixtures';
import { EVENT_FIXTURES } from './seed-events-games';

test.describe.configure({ mode: 'serial' });

async function openEvent(page: Page, title: string, scope: 'upcoming' | 'past' = 'upcoming') {
  await page.goto(scope === 'past' ? '/events?scope=past' : '/events');
  await page
    .getByRole('link', { name: new RegExp(title) })
    .first()
    .click();
  await page.waitForURL(/\/events\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

async function openTab(page: Page, name: string) {
  await page
    .getByRole('navigation', { name: 'Event sections' })
    .getByRole('link', { name })
    .click();
  await page.waitForURL(/tab=/);
}

/** A datetime-local value N days from now at 18:00 (the persona time zone is UTC). */
function daysFromNow(days: number): string {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return `${date.toISOString().slice(0, 10)}T18:00`;
}

test.describe('events — staff', () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, 'operations');
  });

  test('schedules, edits and cancels an event', async ({ page }) => {
    await page.goto('/events');
    await page.getByRole('link', { name: 'New event' }).click();
    await page.waitForURL('**/events/new');
    const form = page.getByRole('form', { name: 'Event' });
    await form.getByLabel('Title').fill('Signal Processing Clinic');
    await form.getByLabel('Kind').selectOption('workshop');
    await form.getByLabel('Description').fill('FFTs by hand, then by machine.');
    await form.getByLabel('Start').fill(daysFromNow(9));
    await form.getByLabel('Capacity').fill('25');
    await form.getByRole('button', { name: 'Schedule event' }).click();
    await page.waitForURL(/\/events\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Signal Processing Clinic' }),
    ).toBeVisible();
    await expect(page.getByText('0 / 25 going · 25 left')).toBeVisible();

    await openTab(page, 'Edit');
    const edit = page.getByRole('form', { name: 'Event' });
    await edit.getByLabel('Capacity').fill('30');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('EVENT UPDATED — Signal Processing Clinic.')).toBeVisible();
    await expect(page.getByText('0 / 30 going · 30 left')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel event' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancel event' });
    await dialog.getByLabel('Reason').fill('Speaker unavailable.');
    await dialog.getByRole('button', { name: 'Cancel event' }).click();
    await expect(page.getByText(/EVENT CANCELLED — Signal Processing Clinic/)).toBeVisible();
    await expect(page.getByText('Speaker unavailable.')).toBeVisible();
  });

  test('BREAK: an impossible schedule is refused on its field', async ({ page }) => {
    await page.goto('/events/new');
    const form = page.getByRole('form', { name: 'Event' });
    await form.getByLabel('Title').fill('Time travel');
    await form.getByLabel('Start').fill(daysFromNow(-2));
    await form.getByRole('button', { name: 'Schedule event' }).click();
    await expect(form.getByText('must be in the future')).toBeVisible();
    await expect(page).toHaveURL(/\/events\/new$/);
  });

  test('attendance: waitlist, and a check-in code shown exactly once', async ({ page }) => {
    await openEvent(page, EVENT_FIXTURES.meetup);
    await openTab(page, 'Attendance');
    const responses = page.getByRole('table', { name: 'Responses' });
    await expect(responses.getByText('WAITLIST #1')).toBeVisible();
    await page.getByRole('button', { name: 'Issue check-in code' }).click();
    const code = page.getByTestId('check-in-code');
    await expect(code).toContainText(/[A-Z0-9]{4}-[A-Z0-9]{4}/);
    const first = await code.locator('p.type-data').innerText();

    // Rotating is confirmed first: attendees may be holding the current code.
    await page.getByRole('button', { name: 'Issue a new code' }).click();
    await page.getByRole('button', { name: 'Keep current code' }).click();
    await expect(code).toContainText(first);
    await page.getByRole('button', { name: 'Issue a new code' }).click();
    await page.getByRole('button', { name: 'Replace code' }).click();
    await expect(code.locator('p.type-data')).not.toHaveText(first);

    await page.reload();
    await expect(page.getByTestId('check-in-code')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Issue a new code' })).toBeVisible();
  });

  test('records a bracket result and the winner advances', async ({ page }) => {
    await openEvent(page, EVENT_FIXTURES.tournament);
    await openTab(page, 'Bracket');
    const bracket = page.getByRole('list', { name: 'Bracket' });
    await expect(bracket.getByText('Quarterfinals')).toBeVisible();
    const ready = bracket.locator('[data-match-status="ready"]').first();
    await ready.getByTestId('report-match').click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input[name="scoreA"]').fill('2');
    await dialog.locator('input[name="scoreB"]').fill('1');
    await dialog.getByRole('button', { name: 'Record result' }).click();
    await expect(page.getByText(/RESULT RECORDED — .+ advances\./)).toBeVisible();
  });

  test('teams are locked once the bracket exists', async ({ page }) => {
    await openEvent(page, EVENT_FIXTURES.tournament);
    await openTab(page, 'Teams');
    await expect(page.getByText('Teams are locked: the bracket exists.')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Teams' }).getByText('Apogee')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Draw teams' })).toHaveCount(0);
  });
});

test.describe('events — members', () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, 'member');
  });

  test('RSVPs from the event page; the full event waitlists', async ({ page }) => {
    await openEvent(page, EVENT_FIXTURES.meetup);
    await page.getByRole('button', { name: 'Going' }).click();
    await expect(page.getByText(/WAITLIST #2 — the event is full/)).toBeVisible();
    await page.getByRole('button', { name: 'Decline' }).click();
    await expect(page.getByText('RSVP RECORDED — DECLINED.')).toBeVisible();
  });

  test('BREAK: staff sections and actions are not offered, and direct URLs fall back', async ({
    page,
  }) => {
    await openEvent(page, EVENT_FIXTURES.meetup);
    const tabs = page.getByRole('navigation', { name: 'Event sections' });
    await expect(tabs.getByRole('link', { name: 'Attendance' })).toHaveCount(0);
    await expect(tabs.getByRole('link', { name: 'Edit' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancel event' })).toHaveCount(0);
    await page.goto(`${page.url()}?tab=attendance`);
    await expect(page.getByText('Your response')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Responses' })).toHaveCount(0);

    await page.goto('/events/new');
    await expect(page.getByText('ACCESS RESTRICTED')).toBeVisible();
    await expect(page.getByRole('form', { name: 'Event' })).toHaveCount(0);

    await page.goto('/events/00000000-0000-4000-8000-000000000000');
    await expect(page.getByText('NOT FOUND')).toBeVisible();
  });

  test('past events keep their outcome; the bracket is read-only', async ({ page }) => {
    await openEvent(page, EVENT_FIXTURES.cancelled, 'past');
    await expect(page.getByText('Venue unavailable. Folded into the autumn meetup.')).toBeVisible();
    await openEvent(page, EVENT_FIXTURES.tournament);
    await openTab(page, 'Bracket');
    await expect(page.getByTestId('report-match')).toHaveCount(0);
  });
});

test.describe('games', () => {
  test('leaderboards rank ranked sessions only, per game and metric', async ({ page }) => {
    await signInAs(page, 'member');
    await page.goto('/games');
    const board = page.getByRole('table', { name: /Trivia leaderboard/ });
    await expect(board.locator('tbody tr').first()).toContainText('Mara Voss');
    // The member's solo run is practice: never on the board.
    await expect(board.getByText('Dev Member')).toHaveCount(0);
    await page
      .getByRole('navigation', { name: 'Order by' })
      .getByRole('link', { name: 'Best score' })
      .click();
    await page.waitForURL(/metric=best_score/);
    await expect(
      page
        .getByRole('table', { name: /by best score/ })
        .locator('tbody tr')
        .first(),
    ).toContainText('Sana Okafor');
    await page
      .getByRole('navigation', { name: 'Games' })
      .getByRole('link', { name: 'Reaction' })
      .click();
    await page.waitForURL(/game=reaction/);
    await expect(page.getByRole('table', { name: /Reaction leaderboard/ })).toContainText(
      'Jun Park',
    );
  });
});
