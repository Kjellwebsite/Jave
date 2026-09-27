import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { type Persona, signInAs } from './fixtures';

/**
 * Visual gauntlet for projects, contributions and integrations. Runs after
 * projects.spec.ts and integrations.spec.ts (file order), so every page has
 * real data. No page may scroll sideways on a phone. JAVE_SCREENSHOTS=1
 * writes the captures to docs/screenshots/.
 */
const SCREENSHOT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SAVE = process.env.JAVE_SCREENSHOTS === '1';
const MAX_CAPTURE_HEIGHT = 2200;

/** Captures at 1440 and 390; 375 (the smallest phone we support) is checked for overflow only. */
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, capture: true },
  { name: 'mobile', width: 390, height: 844, capture: true },
  { name: 'small', width: 375, height: 812, capture: false },
] as const;

async function projectPath(page: Page, search: string, query = ''): Promise<string> {
  await page.goto(`/projects?q=${encodeURIComponent(search)}`);
  const href = await page.locator('[data-project] a').first().getAttribute('href');
  expect(href).toBeTruthy();
  return `${href}${query}`;
}

async function deliveryPath(page: Page): Promise<string> {
  await page.goto('/integrations?tab=deliveries');
  const href = await page.locator('[data-delivery="e2e-accepted"] a').getAttribute('href');
  return href ?? '/integrations?tab=deliveries';
}

interface Shot {
  name: string;
  path: string | ((page: Page) => Promise<string>);
  persona: Persona;
  /** Open this <details> summary before capturing. */
  expand?: RegExp;
}

const SHOTS: readonly Shot[] = [
  { name: 'projects-grid', path: '/projects', persona: 'verified' },
  { name: 'projects-list', path: '/projects?view=list&status=shipped', persona: 'founder' },
  { name: 'projects-new', path: '/projects/new', persona: 'verified' },
  { name: 'projects-overview', path: (page) => projectPath(page, 'orbital'), persona: 'verified' },
  {
    name: 'projects-team',
    path: (page) => projectPath(page, 'orbital', '?tab=team'),
    persona: 'verified',
  },
  {
    name: 'projects-milestones',
    path: (page) => projectPath(page, 'orbital', '?tab=milestones'),
    persona: 'verified',
  },
  {
    name: 'projects-activity',
    path: (page) => projectPath(page, 'orbital', '?tab=activity'),
    persona: 'verified',
  },
  {
    name: 'projects-settings',
    path: (page) => projectPath(page, 'orbital', '?tab=settings'),
    persona: 'verified',
  },
  { name: 'projects-contributions', path: '/contributions?view=verified', persona: 'operations' },
  { name: 'projects-review-queue', path: '/contributions?view=queue', persona: 'operations' },
  { name: 'integrations-inbound', path: '/integrations', persona: 'core' },
  {
    name: 'integrations-deliveries',
    path: deliveryPath,
    persona: 'core',
    expand: /Payload · \d+ characters/,
  },
  { name: 'integrations-outbound', path: '/integrations?tab=outbound', persona: 'core' },
];

for (const viewport of VIEWPORTS) {
  test.describe(`projects & integrations ${viewport.name} (${viewport.width}px)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const persona of ['verified', 'founder', 'operations', 'core'] as const) {
      const shots = SHOTS.filter((shot) => shot.persona === persona);
      test(`${persona} pages`, async ({ page }) => {
        test.setTimeout(180_000);
        await signInAs(page, persona);
        for (const shot of shots) {
          const path = typeof shot.path === 'string' ? shot.path : await shot.path(page);
          await page.goto(path);
          await page.waitForLoadState('networkidle');
          if (shot.expand) await page.getByText(shot.expand).click();
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
    }
  });
}
