import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { type Persona, signInAs } from './fixtures';
import { TRIAL_FIXTURES } from './seed-trials';

/**
 * Visual gauntlet for the trials pages. Every page at desktop (1440) and
 * phone (390) width must not scroll horizontally. With JAVE_SCREENSHOTS=1
 * the captures are written to docs/screenshots/trials-*.png — run this spec
 * alone on a freshly prepared database so the captured states are the seeded
 * ones (the flow spec changes them).
 */
const SCREENSHOT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SAVE = process.env.JAVE_SCREENSHOTS === '1';
const MAX_CAPTURE_HEIGHT = 2400;

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

interface Shot {
  name: string;
  path: string | ((page: Page) => Promise<string>);
}

/** The detail page of a seeded trial, found through the list like a person would. */
function trialPath(title: string, query = '') {
  return async (page: Page) => {
    await page.goto('/trials');
    const href = await page
      .getByRole('link', { name: new RegExp(title) })
      .first()
      .getAttribute('href');
    return `${href}${query}`;
  };
}

async function templatePath(page: Page): Promise<string> {
  await page.goto('/trials/templates');
  const href = await page
    .getByRole('link', { name: /Red Flag Hunt/ })
    .first()
    .getAttribute('href');
  return href ?? '/trials/templates';
}

const FOUNDER_SHOTS: readonly Shot[] = [
  { name: 'trials-list', path: '/trials' },
  { name: 'trials-list-empty', path: '/trials?status=teams_assigned' },
  { name: 'trials-new', path: '/trials/new' },
  { name: 'trials-templates', path: '/trials/templates' },
  { name: 'trials-template', path: templatePath },
  { name: 'trials-overview', path: trialPath(TRIAL_FIXTURES.adversarial) },
  {
    name: 'trials-participants',
    path: trialPath(TRIAL_FIXTURES.recruiting, '?tab=participants'),
  },
  {
    name: 'trials-teams-preview',
    path: trialPath(
      TRIAL_FIXTURES.recruiting,
      '?tab=teams&strategy=balanced&size=2&seed=e2e-visual',
    ),
  },
  { name: 'trials-teams', path: trialPath(TRIAL_FIXTURES.adversarial, '?tab=teams') },
  { name: 'trials-submissions', path: trialPath(TRIAL_FIXTURES.evaluating, '?tab=submissions') },
  { name: 'trials-evaluation', path: trialPath(TRIAL_FIXTURES.completed, '?tab=evaluation') },
  { name: 'trials-results-preview', path: trialPath(TRIAL_FIXTURES.evaluating, '?tab=results') },
  { name: 'trials-results', path: trialPath(TRIAL_FIXTURES.completed, '?tab=results') },
  { name: 'trials-adversarial', path: trialPath(TRIAL_FIXTURES.adversarial, '?tab=adversarial') },
  { name: 'trials-cancelled', path: trialPath(TRIAL_FIXTURES.cancelled) },
];

const OTHER_SHOTS: readonly (Shot & { persona: Persona })[] = [
  { name: 'trials-restricted', path: '/trials', persona: 'verified' },
];

async function capture(page: Page, name: string, width: number) {
  await page.waitForLoadState('networkidle');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, `${name} scrolls horizontally at ${width}px`).toBeLessThanOrEqual(0);
  if (!SAVE) return;
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.screenshot({
    path: `${SCREENSHOT_DIR}${name}-${width}.png`,
    clip: { x: 0, y: 0, width, height: Math.min(height, MAX_CAPTURE_HEIGHT) },
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`trials ${viewport.name} (${viewport.width}px)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('staff pages', async ({ page }) => {
      test.setTimeout(240_000);
      await signInAs(page, 'founder');
      for (const shot of FOUNDER_SHOTS) {
        const path = typeof shot.path === 'string' ? shot.path : await shot.path(page);
        await page.goto(path);
        await capture(page, shot.name, viewport.width);
      }
    });

    test('non-staff pages', async ({ page }) => {
      for (const shot of OTHER_SHOTS) {
        await signInAs(page, shot.persona);
        await page.goto(typeof shot.path === 'string' ? shot.path : await shot.path(page));
        await capture(page, shot.name, viewport.width);
      }
    });
  });
}
