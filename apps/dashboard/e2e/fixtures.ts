import { expect, type Page } from '@playwright/test';
import postgres from 'postgres';
import { E2E_DATABASE_URL } from './database-url';

export type Persona = 'founder' | 'core' | 'operations' | 'moderator' | 'verified' | 'member';

/**
 * The suite signs in some two hundred times from one address, far beyond dev
 * login's per-client budget (the budget itself is unit-tested). Start each
 * sign-in with a fresh dev-login bucket so a test never fails on the order it
 * happens to run in. Touches only the e2e database, only dev-login buckets.
 */
async function resetDevLoginBudget(): Promise<void> {
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => undefined });
  try {
    await sql`delete from rate_limit_buckets where key like 'auth:devLogin:%'`;
  } finally {
    await sql.end();
  }
}

/** DEV LOGIN — MOCK / DEVELOPMENT ONLY: signs in through the real dev-login Server Action. */
export async function signInAs(page: Page, persona: Persona): Promise<void> {
  await resetDevLoginBudget();
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
