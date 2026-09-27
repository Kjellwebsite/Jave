import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { type Persona, signInAs } from './fixtures';
import { SEEDED_PAPERS } from './seed-ai-research';

/**
 * Visual gauntlet for /ai and /research: every page at desktop (1440) and
 * phone (390) width must not scroll horizontally. With JAVE_SCREENSHOTS=1 the
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

async function itemPath(page: Page, title: string): Promise<string> {
  await page.goto(`/research?q=${encodeURIComponent(title)}`);
  const href = await page.getByRole('link', { name: title }).first().getAttribute('href');
  if (!href) throw new Error(`no research item titled ${title}`);
  return href;
}

const SHOTS: readonly Shot[] = [
  { name: 'ai-overview', path: '/ai', persona: 'founder' },
  { name: 'ai-proposals', path: '/ai?tab=proposals', persona: 'founder' },
  { name: 'ai-ledger', path: '/ai?tab=ledger', persona: 'founder' },
  { name: 'research-library', path: '/research', persona: 'founder' },
  { name: 'research-item-review', path: (page) => itemPath(page, SEEDED_PAPERS.sleep), persona: 'founder' },
  { name: 'research-item-verified', path: (page) => itemPath(page, SEEDED_PAPERS.numpy), persona: 'founder' },
  { name: 'research-empty', path: '/research?q=no-such-reference', persona: 'founder' },
  { name: 'ai-member', path: '/ai', persona: 'member' },
  { name: 'ai-member-proposals', path: '/ai?tab=proposals', persona: 'member' },
];

for (const viewport of VIEWPORTS) {
  test.describe(`ai and research ${viewport.name} (${viewport.width}px)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const persona of ['founder', 'member'] as const) {
      const shots = SHOTS.filter((shot) => shot.persona === persona);
      test(`${persona} pages`, async ({ page }) => {
        test.setTimeout(180_000);
        await signInAs(page, persona);
        for (const shot of shots) {
          const path = typeof shot.path === 'string' ? shot.path : await shot.path(page);
          await page.goto(path);
          await page.waitForLoadState('networkidle');
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          expect(overflow, `${shot.name} scrolls horizontally at ${viewport.width}px`).toBeLessThanOrEqual(0);
          if (SAVE) {
            const height = await page.evaluate(() => document.documentElement.scrollHeight);
            await page.screenshot({
              path: `${SCREENSHOT_DIR}${shot.name}-${viewport.width}.png`,
              clip: { x: 0, y: 0, width: viewport.width, height: Math.min(height, MAX_CAPTURE_HEIGHT) },
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
