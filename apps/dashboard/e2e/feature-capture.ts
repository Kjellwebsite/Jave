import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

/**
 * Visual gauntlet for one feature's pages: at 1440 and 390 px the page must
 * not scroll sideways; with JAVE_SCREENSHOTS=1 each capture is written to
 * docs/screenshots/<name>-<width>.png.
 */
const SCREENSHOT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SAVE = process.env.JAVE_SCREENSHOTS === '1';
/** Cap very long pages so the committed images stay small. */
const MAX_CAPTURE_HEIGHT = 2200;

export const CAPTURE_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

/**
 * Opens `path` at each capture width, optionally brings the page into a state
 * (`prepare`: open a dialog, pick a member…), checks for sideways scrolling
 * and saves the capture.
 */
export async function capture(
  page: Page,
  name: string,
  path: string,
  prepare?: (page: Page) => Promise<void>,
): Promise<void> {
  for (const viewport of CAPTURE_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    if (prepare) await prepare(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `${name} scrolls horizontally at ${viewport.width}px`).toBeLessThanOrEqual(0);
    if (!SAVE) continue;
    const height = prepare
      ? viewport.height
      : await page.evaluate(() => document.documentElement.scrollHeight);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}${name}-${viewport.width}.png`,
      clip: { x: 0, y: 0, width: viewport.width, height: Math.min(height, MAX_CAPTURE_HEIGHT) },
      fullPage: !prepare,
      animations: 'disabled',
      caret: 'hide',
    });
  }
  await page.setViewportSize(CAPTURE_VIEWPORTS[0]);
}
