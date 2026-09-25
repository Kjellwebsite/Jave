import { expect, type Page } from '@playwright/test';

export type Persona = 'founder' | 'core' | 'operations' | 'moderator' | 'verified' | 'member';

/** DEV LOGIN — MOCK / DEVELOPMENT ONLY: signs in through the real dev-login Server Action. */
export async function signInAs(page: Page, persona: Persona): Promise<void> {
  await page.goto('/login');
  await page.locator(`button[data-persona="${persona}"]`).click();
  await page.waitForURL('**/overview');
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
}

/** Opens a member's page from the directory by name. */
export async function openMember(page: Page, name: string, tab?: string): Promise<void> {
  await page.goto(`/members?q=${encodeURIComponent(name)}`);
  await page
    .getByRole('link', { name: new RegExp(name) })
    .first()
    .click();
  await page.waitForURL(/\/members\/[0-9a-f-]{36}/);
  if (tab) {
    await page
      .getByRole('navigation', { name: 'Member sections' })
      .getByRole('link', { name: tab })
      .click();
    await page.waitForURL(/tab=/);
  }
}
