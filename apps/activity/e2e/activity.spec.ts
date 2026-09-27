import { fileURLToPath } from 'node:url';
import { type Browser, expect, type Page, test } from '@playwright/test';

/**
 * The Activity end to end, in standalone dev mode (MOCK / DEVELOPMENT ONLY):
 * real dashboard routes, real database, two browser contexts as two players.
 * With JAVE_SCREENSHOTS=1 the captures are written to docs/screenshots/, or to
 * JAVE_SCREENSHOT_DIR when set (review iterations outside the repository).
 */
const SCREENSHOT_DIR = process.env.JAVE_SCREENSHOT_DIR
  ? `${process.env.JAVE_SCREENSHOT_DIR.replace(/\/+$/, '')}/`
  : fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SAVE = process.env.JAVE_SCREENSHOTS === '1';

const DESKTOP = { width: 1280, height: 720 } as const;
const PHONE = { width: 390, height: 844 } as const;
type Viewport = typeof DESKTOP | typeof PHONE;

const ROUNDS = 5;
/** Reveal (5 s) + the 2 s a player tick waits for the worker + polling slack. */
const NEXT_ROUND_TIMEOUT_MS = 20_000;

function uniqueInstance(label: string): string {
  return `e2e-${label}-${Date.now().toString(36)}`;
}

async function launch(
  browser: Browser,
  persona: string,
  instance: string,
  viewport: Viewport,
): Promise<Page> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(`/?persona=${persona}&instance=${instance}`);
  await expect(page.getByTestId('dev-bar')).toContainText('MOCK / DEVELOPMENT ONLY');
  return page;
}

async function capture(page: Page, name: string): Promise<void> {
  if (!SAVE) return;
  const width = page.viewportSize()?.width ?? DESKTOP.width;
  await page.screenshot({ path: `${SCREENSHOT_DIR}activity-${name}-${width}.png` });
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

function round(page: Page) {
  return page.getByTestId('round');
}

async function expectPhase(page: Page, number: number, phase: 'question' | 'reveal') {
  await expect(round(page)).toHaveAttribute('data-round', String(number), {
    timeout: NEXT_ROUND_TIMEOUT_MS,
  });
  await expect(round(page)).toHaveAttribute('data-phase', phase, {
    timeout: NEXT_ROUND_TIMEOUT_MS,
  });
}

test.describe('Mission Control', () => {
  for (const viewport of [DESKTOP, PHONE]) {
    test(`shows the member’s own ranks, missions, trial and events at ${viewport.width}px`, async ({
      browser,
    }) => {
      const page = await launch(browser, 'verified', uniqueInstance('mc'), viewport);
      const view = page.getByTestId('mission-control');
      await expect(view).toBeVisible();
      await expect(view.getByRole('heading', { name: 'Dev Verified' })).toBeVisible();
      // VERIFIED, CLAIMED and UNKNOWN are distinct, per domain; never a total.
      await expect(view.getByRole('img', { name: 'Rank A, verified' }).first()).toBeVisible();
      await expect(view.getByRole('img', { name: 'Rank C, claimed, not verified' })).toBeVisible();
      await expect(view.getByText('Night Build')).toBeVisible();
      await expect(page.getByTestId('trial-countdown')).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
      await expect(view.getByText('Prototype sprint')).toBeVisible();
      await expect(view.getByText('Paper teardown')).toBeVisible();
      await expect(view.getByText('Build night')).toBeVisible();
      await expect(view.getByText('meet.example.com')).toBeVisible();
      await expect(page.locator('body')).not.toContainText(/adversarial/i);
      await expectNoHorizontalScroll(page);
      await capture(page, 'mission-control');

      // Facets open per domain.
      await view.getByRole('button', { name: /^Create: Rank B, verified/ }).click();
      await expect(view.getByText('CREATE · FACETS')).toBeVisible();
      await page.context().close();
    });
  }

  test('a member without records sees calm empty states', async ({ browser }) => {
    const page = await launch(browser, 'member', uniqueInstance('mc-empty'), PHONE);
    const view = page.getByTestId('mission-control');
    await expect(view.getByText('NO ACTIVE MISSIONS')).toBeVisible();
    await expect(view.getByText('NO ACTIVE TRIAL')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.context().close();
  });
});

test.describe('JVLN Arena · trivia', () => {
  test('two players play a full game to completion', async ({ browser }) => {
    const instance = uniqueInstance('arena');
    const host = await launch(browser, 'verified', instance, DESKTOP);
    const guest = await launch(browser, 'member', instance, PHONE);

    // The host opens a short lobby.
    await host.getByRole('tab', { name: /JVLN ARENA/ }).click();
    await expect(host.getByTestId('arena-open')).toBeVisible();
    await capture(host, 'arena-open');
    await host.getByRole('group', { name: 'ROUNDS' }).getByText('5', { exact: true }).click();
    await host
      .getByRole('group', { name: 'TIME PER QUESTION' })
      .getByText('10 S', { exact: true })
      .click();
    await host.getByRole('button', { name: 'Open lobby' }).click();
    await expect(host.getByTestId('lobby')).toContainText('PRACTICE · NOT RANKED');
    await expect(host.getByTestId('lobby')).toContainText('5 ROUNDS · 10 S PER QUESTION');

    // The guest's Activity finds the live lobby on its own and joins it.
    await guest.getByRole('tab', { name: /JVLN ARENA/ }).click();
    await expect(guest.getByTestId('lobby')).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Start game' })).toHaveCount(0);
    await expect(guest.getByRole('button', { name: 'Close lobby' })).toHaveCount(0);
    await guest.getByRole('button', { name: 'Join lobby' }).click();
    await expect(guest.getByTestId('lobby-players').getByRole('listitem')).toHaveCount(2);
    await capture(guest, 'arena-lobby');

    await expect(host.getByTestId('lobby-players').getByRole('listitem')).toHaveCount(2);
    await expect(host.getByTestId('lobby')).not.toContainText('PRACTICE');
    await capture(host, 'arena-lobby');
    await host.getByRole('button', { name: 'Start game' }).click();

    for (let number = 1; number <= ROUNDS; number++) {
      await expectPhase(host, number, 'question');
      await expectPhase(guest, number, 'question');
      await expect(host.getByTestId('question-prompt')).not.toBeEmpty();
      if (number === 1) {
        await capture(host, 'arena-question');
        await capture(guest, 'arena-question');
      }

      // The host answers by keyboard on even rounds, by click otherwise.
      if (number % 2 === 0) await host.keyboard.press('b');
      else await host.getByTestId('option-0').click();
      const hostChoice = number % 2 === 0 ? 1 : 0;
      await expect(host.getByTestId(`option-${hostChoice}`)).toHaveAttribute(
        'data-state',
        /locked|correct|wrong/,
      );
      if (number === 1) {
        await expect(host.getByTestId('round-status')).toContainText('Waiting for 1 more player');
        await expect(host.getByTestId('scoreboard')).toContainText('1 / 2 ANSWERED');
        await capture(host, 'arena-locked');
      }

      await guest.getByTestId('option-2').click();
      await expectPhase(guest, number, 'reveal');
      await expectPhase(host, number, 'reveal');
      await expect(guest.getByTestId('reveal-fact')).not.toBeEmpty();
      await expect(host.locator('[data-state="correct"]')).toHaveCount(1);
      await expect(host.getByTestId('round-status')).toContainText(/CORRECT|INCORRECT/);
      if (number === 1) {
        await capture(host, 'arena-reveal');
        await capture(guest, 'arena-reveal');
      }
    }

    // Final placements, identical for both players.
    for (const page of [host, guest]) {
      await expect(page.getByTestId('results')).toBeVisible({ timeout: NEXT_ROUND_TIMEOUT_MS });
      await expect(page.getByTestId('podium-spot')).toHaveCount(2);
      await expect(page.getByTestId('your-result')).toContainText(/YOU PLACED (1ST|2ND)/);
      await expectNoHorizontalScroll(page);
    }
    const order = async (page: Page) =>
      page
        .getByTestId('podium-spot')
        .evaluateAll((spots) => spots.map((spot) => spot.firstElementChild?.textContent));
    expect(await order(host)).toEqual(await order(guest));
    await capture(host, 'arena-results');
    await capture(guest, 'arena-results');
    await host.context().close();
    await guest.context().close();
  });

  test('BREAK: a lost connection is shown and recovered from', async ({ browser }) => {
    const instance = uniqueInstance('offline');
    const host = await launch(browser, 'verified', instance, DESKTOP);
    await host.getByRole('tab', { name: /JVLN ARENA/ }).click();
    await host.getByRole('button', { name: 'Open lobby' }).click();
    await expect(host.getByTestId('lobby')).toBeVisible();

    await host.route('**/api/activity/trivia/**', (route) => route.abort('connectionrefused'));
    await expect(host.getByRole('status').filter({ hasText: 'RECONNECTING' })).toBeVisible();
    await host.unroute('**/api/activity/trivia/**');
    await expect(host.getByRole('status').filter({ hasText: 'ONLINE' })).toBeVisible();
    await expect(host.getByTestId('lobby')).toBeVisible();

    // The host closes the lobby; the instance is free for the next one.
    await expect(host.getByRole('button', { name: 'Leave' })).toHaveCount(0);
    await host.getByRole('button', { name: 'Close lobby' }).click();
    await expect(host.getByTestId('ended')).toContainText('Stopped by the host.');
    await host.context().close();
  });

  test('BREAK: an unknown persona gets no token', async ({ browser }) => {
    const page = await launch(browser, 'nobody', uniqueInstance('forged'), DESKTOP);
    await expect(page.getByText('SIGN-IN FAILED')).toBeVisible();
    await expect(page.getByText('Unknown persona.')).toBeVisible();
    await page.context().close();
  });
});
