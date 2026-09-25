import { expect, type Page } from '@playwright/test';

export async function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

/** Answer whatever the runner shows until the report appears. Answers are arbitrary, not correct. */
export async function playUntilReport(page: Page, maxSteps = 400) {
  for (let i = 0; i < maxSteps; i++) {
    if (page.url().includes('#report')) return;
    const state = await page.evaluate(() => {
      const vis = (el: Element | null) => !!el && (el as HTMLElement).offsetParent !== null;
      if (vis(document.querySelector('.confidence'))) return 'confidence';
      const entry = document.querySelector('.entry-input:not(:disabled)');
      if (vis(entry)) return 'entry';
      const opt = document.querySelector('.choice-option:not(:disabled)');
      if (vis(opt)) return 'choice';
      const btn = [...document.querySelectorAll('main .btn-primary:not(:disabled)')].find(vis);
      if (btn) return 'button';
      return 'wait';
    });
    const quick = { timeout: 2000 };
    try {
      if (state === 'confidence') {
        await page.locator('.confidence-range').focus(quick);
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Enter');
      } else if (state === 'entry') {
        await page.locator('.entry-input:not(:disabled)').last().fill(String(1 + (i % 7)), quick);
        await page.keyboard.press('Enter');
      } else if (state === 'choice') {
        await page.locator('.choice-option:not(:disabled)').last().click(quick);
        await page.locator('main .btn-primary:not(:disabled)').last().click(quick);
      } else if (state === 'button') {
        await page.locator('main .btn-primary:not(:disabled)').last().click(quick);
      } else {
        await page.waitForTimeout(150);
      }
    } catch {
      // The element was mid-transition; the next loop iteration re-reads the state.
    }
    await page.waitForTimeout(250);
  }
  throw new Error('report not reached');
}

export async function startSingle(page: Page, title: string) {
  await page.goto('/#library');
  await page.getByRole('button', { name: new RegExp(title) }).first().click();
  await expect(page).toHaveURL(/#assessment/);
}

export async function storedResponses(page: Page): Promise<number> {
  return page.evaluate(() => {
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (!k.startsWith('jvln.v1.s_')) continue;
      const s = JSON.parse(localStorage.getItem(k)!);
      n += s.sections.reduce((a: number, x: { responses: unknown[] }) => a + x.responses.length, 0);
    }
    return n;
  });
}
