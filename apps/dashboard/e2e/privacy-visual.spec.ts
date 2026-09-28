import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { openMember, type Persona, signInAs } from './fixtures';

/**
 * Visual gauntlet for the privacy surfaces at desktop (1440) and phone (390)
 * width: no page may scroll horizontally. With JAVE_SCREENSHOTS=1 the
 * captures are written to docs/screenshots/ (or JAVE_SCREENSHOT_DIR).
 */
const SCREENSHOT_DIR =
  process.env.JAVE_SCREENSHOT_DIR ??
  fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SAVE = process.env.JAVE_SCREENSHOTS === '1';
const MAX_CAPTURE_HEIGHT = 2200;

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

interface Shot {
  name: string;
  persona: Persona;
  open: (page: Page) => Promise<void>;
}

const SHOTS: readonly Shot[] = [
  {
    name: 'privacy-me',
    persona: 'member',
    open: async (page) => {
      await page.goto('/me?tab=privacy');
    },
  },
  {
    name: 'privacy-member-founder',
    persona: 'founder',
    // A departed member without staff roles: every control is available.
    open: (page) => openMember(page, 'Kasimir Wolde', 'Account'),
  },
  {
    name: 'privacy-member-moderator',
    persona: 'moderator',
    open: (page) => openMember(page, 'Ayla Moreau', 'Account'),
  },
];

for (const viewport of VIEWPORTS) {
  test.describe(`privacy — ${viewport.name} (${viewport.width}px)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const shot of SHOTS) {
      test(shot.name, async ({ page }) => {
        await signInAs(page, shot.persona);
        await shot.open(page);
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
      });
    }
  });
}
