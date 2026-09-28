import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { openMember, signInAs } from './fixtures';
import { ERASURE_TARGET } from './seed';

test.describe('privacy', () => {
  test('a member downloads their data and sees their sessions', async ({ page }) => {
    await signInAs(page, 'member');
    await page.goto('/me?tab=privacy');
    await expect(page.getByRole('heading', { name: 'YOUR DATA' })).toBeVisible();
    await expect(
      page.locator('[data-session-row]').filter({ hasText: 'THIS BROWSER' }),
    ).toHaveCount(1);
    const downloading = page.waitForEvent('download');
    await page.getByTestId('export-data').click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(
      /^jave-export-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.json$/,
    );
    const document = JSON.parse(await readFile((await download.path())!, 'utf8')) as {
      format: string;
      sections: { account: { profile: { displayName: string } | null } };
    };
    expect(document.format).toBe('jave.member-export');
    expect(document.sections.account.profile).not.toBeNull();
    await expect(page.getByText('DATA EXPORTED')).toBeVisible();
  });

  test('BREAK: a cross-site POST cannot trigger an export', async ({ page }) => {
    // Signed in: the browser would attach the session cookie to a forged form post.
    await signInAs(page, 'member');
    const response = await page.request.post('/me/export', {
      headers: {
        origin: 'https://evil.example',
        'content-type': 'application/x-www-form-urlencoded',
      },
      data: 'x=1',
      maxRedirects: 0,
    });
    expect(response.status()).toBe(403);
    expect(response.headers()['content-disposition']).toBeUndefined();
  });

  test('members see no account controls on other members', async ({ page }) => {
    await signInAs(page, 'member');
    await openMember(page, 'Priya Raman');
    await expect(
      page
        .getByRole('navigation', { name: 'Member sections' })
        .getByRole('link', { name: 'Account' }),
    ).toHaveCount(0);
  });

  test('a moderator can end a member’s sessions but cannot erase', async ({ page }) => {
    await signInAs(page, 'moderator');
    await openMember(page, 'Ayla Moreau', 'Account');
    await expect(page.getByTestId('end-member-sessions')).toBeVisible();
    await expect(page.getByTestId('erase-member')).toHaveCount(0);
    await page.getByTestId('end-member-sessions').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Reason').fill('Reported a stolen laptop.');
    await dialog.getByRole('button', { name: 'End all sessions' }).click();
    await expect(page.getByText(/sessions? ended\./)).toBeVisible();
  });

  test('a founder erases a departed member', async ({ page }) => {
    await signInAs(page, 'founder');
    await openMember(page, ERASURE_TARGET.name, 'Account');
    await page.getByTestId('erase-member').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Reason').fill('Data-subject request DSR-12, verified by email.');
    await dialog.getByLabel(`Type ${ERASURE_TARGET.handle} to confirm`).fill('not-her-handle');
    await dialog.getByRole('button', { name: 'Erase personal data' }).click();
    await expect(dialog.getByText(`Type ${ERASURE_TARGET.handle} to confirm.`)).toBeVisible();
    await dialog.getByLabel(`Type ${ERASURE_TARGET.handle} to confirm`).fill(ERASURE_TARGET.handle);
    await dialog.getByRole('button', { name: 'Erase personal data' }).click();
    await page.waitForURL(/\/members\?erased=1/);
    await expect(page.getByText('Personal data erased.')).toBeVisible();
    await page.goto(`/members?q=${encodeURIComponent('Vera')}`);
    await expect(page.getByRole('link', { name: /Vera Lind/ })).toHaveCount(0);
    await page.goto(`/p/${ERASURE_TARGET.handle}`);
    await expect(page.getByText('Vera Lind')).toHaveCount(0);
  });

  test('sign out everywhere ends this session too', async ({ page }) => {
    await signInAs(page, 'verified');
    await page.goto('/me?tab=privacy');
    await page.getByTestId('sign-out-everywhere').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Sign out everywhere' }).click();
    await page.waitForURL('**/login**');
    await page.goto('/overview');
    await expect(page).toHaveURL(/\/login/);
  });
});
