import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { type Persona, signInAs } from './fixtures';
import { EVENT_FIXTURES } from './seed-events-games';

/**
 * Visual gauntlet for events and games, at desktop (1440) and phone (390)
 * width: no page may scroll horizontally. With JAVE_SCREENSHOTS=1 the
 * captures are written to docs/screenshots/.
 */
const SCREENSHOT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SAVE = process.env.JAVE_SCREENSHOTS === '1';
const MAX_CAPTURE_HEIGHT = 2200;

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

interface Shot {
  name: string;
  path: string | ((page: Page) => Promise<string>);
  persona: Persona;
}

async function eventPath(page: Page, title: string, query = '', scope = ''): Promise<string> {
  await page.goto(`/events${scope}`);
  const href = await page
    .getByRole('link', { name: new RegExp(title) })
    .first()
    .getAttribute('href');
  return `${href}${query}`;
}

const SHOTS: readonly Shot[] = [
  { name: 'events', path: '/events', persona: 'founder' },
  { name: 'events-past', path: '/events?scope=past', persona: 'founder' },
  { name: 'event-new', path: '/events/new', persona: 'founder' },
  {
    name: 'event-overview',
    path: (page) => eventPath(page, EVENT_FIXTURES.meetup),
    persona: 'founder',
  },
  {
    name: 'event-attendance',
    path: (page) => eventPath(page, EVENT_FIXTURES.meetup, '?tab=attendance'),
    persona: 'founder',
  },
  {
    name: 'event-teams',
    path: (page) => eventPath(page, EVENT_FIXTURES.tournament, '?tab=teams'),
    persona: 'founder',
  },
  {
    name: 'event-bracket',
    path: (page) => eventPath(page, EVENT_FIXTURES.tournament, '?tab=bracket'),
    persona: 'founder',
  },
  {
    name: 'event-cancelled',
    path: (page) => eventPath(page, EVENT_FIXTURES.cancelled, '', '?scope=past'),
    persona: 'founder',
  },
  { name: 'games', path: '/games', persona: 'founder' },
  {
    name: 'event-member',
    path: (page) => eventPath(page, EVENT_FIXTURES.live),
    persona: 'member',
  },
  { name: 'events-member', path: '/events', persona: 'member' },
];

for (const viewport of VIEWPORTS) {
  test.describe(`events and games — ${viewport.name} (${viewport.width}px)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const persona of ['founder', 'member'] as const) {
      test(`${persona} pages`, async ({ page }) => {
        test.setTimeout(180_000);
        await signInAs(page, persona);
        for (const shot of SHOTS.filter((candidate) => candidate.persona === persona)) {
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
