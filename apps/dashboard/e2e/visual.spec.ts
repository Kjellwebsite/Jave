import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { type Persona, signInAs } from './fixtures';

/**
 * Visual gauntlet. Every page at desktop (1440) and phone (390) width:
 * the page must not scroll horizontally on a phone. With
 * JAVE_SCREENSHOTS=1 the captures are written to docs/screenshots/.
 */
const SCREENSHOT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SAVE = process.env.JAVE_SCREENSHOTS === '1';
/** Cap very long pages so the committed images stay small. */
const MAX_CAPTURE_HEIGHT = 2200;

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

interface Shot {
  name: string;
  path: string | ((page: Page) => Promise<string>);
  persona: Persona | null;
}

async function memberPath(page: Page, name: string, query = ''): Promise<string> {
  await page.goto(`/members?q=${encodeURIComponent(name)}`);
  const href = await page
    .getByRole('link', { name: new RegExp(name) })
    .first()
    .getAttribute('href');
  return `${href}${query}`;
}

const SHOTS: readonly Shot[] = [
  { name: 'login', path: '/login', persona: null },
  { name: 'public-profile', path: '/p/mara', persona: null },
  { name: 'overview', path: '/overview', persona: 'founder' },
  { name: 'members', path: '/members', persona: 'founder' },
  { name: 'members-empty', path: '/members?q=nobody-by-that-name', persona: 'founder' },
  { name: 'member-capability', path: (page) => memberPath(page, 'Mara Voss'), persona: 'founder' },
  {
    name: 'member-roles',
    path: (page) => memberPath(page, 'Mara Voss', '?tab=roles'),
    persona: 'founder',
  },
  {
    name: 'member-history',
    path: (page) => memberPath(page, 'Mara Voss', '?tab=history'),
    persona: 'founder',
  },
  {
    name: 'member-notes',
    path: (page) => memberPath(page, 'Ilya Brenner', '?tab=notes'),
    persona: 'founder',
  },
  { name: 'ranking', path: '/ranking', persona: 'founder' },
  { name: 'ranking-empty', path: '/ranking?facet=body.physical', persona: 'founder' },
  { name: 'me-profile', path: '/me', persona: 'founder' },
  { name: 'me-claims', path: '/me?tab=claims', persona: 'founder' },
  { name: 'me-preferences', path: '/me?tab=preferences', persona: 'founder' },
  { name: 'notifications', path: '/notifications', persona: 'founder' },
  { name: 'audit', path: '/audit', persona: 'founder' },
  { name: 'settings', path: '/settings', persona: 'founder' },
  { name: 'settings-moderation', path: '/settings?section=moderation', persona: 'founder' },
  { name: 'overview-member', path: '/overview', persona: 'member' },
  { name: 'restricted', path: '/settings', persona: 'member' },
  { name: 'not-found', path: '/p/nobody-here', persona: null },
];

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} (${viewport.width}px)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const persona of [null, 'founder', 'member'] as const) {
      const shots = SHOTS.filter((shot) => shot.persona === persona);
      test(`${persona ?? 'signed out'} pages`, async ({ page }) => {
        test.setTimeout(180_000);
        if (persona) await signInAs(page, persona);
        for (const shot of shots) {
          const path = typeof shot.path === 'string' ? shot.path : await shot.path(page);
          await page.goto(path);
          await page.waitForLoadState('networkidle');
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          expect(
            overflow,
            `${shot.name} scrolls horizontally at ${viewport.width}px`,
          ).toBeLessThanOrEqual(0);
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
    }
  });
}

test.describe('phone rails', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the active tab or section is scrolled into view', async ({ page }) => {
    await signInAs(page, 'founder');
    const targets = [
      { path: await memberPath(page, 'Ilya Brenner', '?tab=notes'), rail: 'Member sections' },
      { path: '/settings?section=analytics', rail: 'Settings sections' },
    ];
    for (const target of targets) {
      await page.goto(target.path);
      await page.waitForLoadState('networkidle');
      const active = page
        .getByRole('navigation', { name: target.rail })
        .locator('[aria-current="page"]');
      // Horizontal containment only: the rail may sit below the fold.
      await expect
        .poll(
          () =>
            active.evaluate((element) => {
              const rail = element.closest('nav')!.getBoundingClientRect();
              const item = element.getBoundingClientRect();
              return item.left >= rail.left && item.right <= rail.right;
            }),
          { message: `${target.rail} active item is visible on ${target.path}` },
        )
        .toBe(true);
    }
  });
});
