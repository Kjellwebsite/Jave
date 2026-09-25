import { expect, test } from '@playwright/test';
import { openMember, signInAs } from './fixtures';

test.describe.configure({ mode: 'serial' });

test.describe('founder operations', () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, 'founder');
  });

  test('overview shows live organization counts', async ({ page }) => {
    const metrics = page.getByRole('region', { name: 'Organization metrics' });
    for (const label of [
      'MEMBERS PRESENT',
      'OPEN APPLICATIONS',
      'ACTIVE TRIALS',
      'OPEN TICKETS',
      'SECURITY EVENTS',
      'VERIFIED CAPABILITIES',
      'PROJECTS SHIPPED',
    ]) {
      await expect(metrics.getByText(label)).toBeVisible();
    }
    await expect(page.getByText('Recent activity')).toBeVisible();
    await expect(page.getByTestId('unread-count')).toHaveText('3');
  });

  test('members can be searched and filtered', async ({ page }) => {
    await page.goto('/members');
    await page.getByRole('searchbox', { name: 'Search members' }).fill('voss');
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.waitForURL(/q=voss/);
    const rows = page.getByRole('table', { name: 'Members' }).locator('tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Mara Voss');

    await page.goto('/members?standing=restricted');
    await expect(page.getByRole('table', { name: 'Members' }).locator('tbody tr')).toHaveCount(1);
    await expect(page.getByText('Ayla Moreau')).toBeVisible();

    await page.goto('/members?q=zzzz-nobody');
    await expect(page.getByText('NO MATCHES')).toBeVisible();
  });

  test('a role is granted with a required reason, after confirmation', async ({ page }) => {
    await openMember(page, 'Jun Park', 'Roles');
    await page.getByTestId('grant-role').click();
    const dialog = page.getByRole('dialog', { name: 'Grant role' });
    await dialog.getByLabel('Role').selectOption('supporter');
    await dialog.getByRole('button', { name: 'Grant role' }).click();
    // The reason is required: the browser refuses to submit an empty one.
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Reason').fill('Backed the autumn trial season.');
    await dialog.getByRole('button', { name: 'Grant role' }).click();
    await expect(page.getByText('ROLE GRANTED — SUPPORTER — Jun Park.')).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-role-row="supporter"]')).toContainText(
      'Backed the autumn trial season.',
    );
  });

  test('an evaluator verifies a rank on another member and the badge changes', async ({ page }) => {
    await openMember(page, 'Ilya Brenner');
    const facet = page.locator('[data-facet="mind.knowledge"]');
    await expect(facet.locator('[data-rank-status="claimed"]')).toBeVisible();
    await page.getByTestId('set-rank-mind.knowledge').click();
    const dialog = page.getByRole('dialog', { name: 'Set verified rank' });
    await dialog.getByLabel('Verified rank').selectOption('A');
    await dialog.getByLabel('Reason').fill('Defended a distributed consensus design under review.');
    await dialog.getByRole('button', { name: 'Set verified rank' }).click();
    await expect(page.getByText('RANK VERIFIED — KNOWLEDGE — A.')).toBeVisible();
    await expect(facet.locator('[data-rank-status="verified"]')).toHaveAttribute(
      'aria-label',
      'Rank A, verified',
    );
    await expect(facet.getByText('claimed B')).toBeVisible();

    await page.getByRole('link', { name: 'Rank history' }).click();
    await expect(
      page.getByText('Defended a distributed consensus design under review.'),
    ).toBeVisible();
  });

  test('BREAK: nobody gets evaluator controls on their own profile', async ({ page }) => {
    await page.getByRole('button', { name: /Account menu/ }).click();
    await page.getByRole('menuitem', { name: 'My profile' }).click();
    await page.waitForURL('**/me');
    await page.goto('/members?q=Dev%20Founder');
    await page.getByRole('link', { name: /Dev Founder/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dev Founder' })).toBeVisible();
    await expect(page.locator('[data-testid^="set-rank-"]')).toHaveCount(0);
  });

  test('staff notes can be added', async ({ page }) => {
    await openMember(page, 'Ilya Brenner', 'Staff notes');
    await expect(page.getByText('Strong systems instincts.')).toBeVisible();
    await page.getByRole('textbox', { name: 'Note' }).fill('Scheduled for the next build trial.');
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect(page.getByText('Note added.')).toBeVisible();
    await expect(page.getByText('Scheduled for the next build trial.')).toBeVisible();
  });

  test('a settings change is validated, saved and persists', async ({ page }) => {
    await page.goto('/settings?section=branding');
    const motto = page.getByLabel('Motto');
    await motto.fill('PROVE IT. THEN PROVE IT AGAIN.');
    await page.getByRole('button', { name: 'Save branding' }).click();
    await expect(page.getByText('BRANDING SAVED.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Motto')).toHaveValue('PROVE IT. THEN PROVE IT AGAIN.');

    await page.goto('/settings?section=moderation');
    await page.getByLabel('Spam: max messages').fill('500');
    await page
      .getByLabel('Spam: max messages')
      .evaluate((input: HTMLInputElement) => input.removeAttribute('max'));
    await page.getByRole('button', { name: 'Save moderation' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /50/ }).first()).toBeVisible();
  });

  test('BREAK: clearing a channel ID disables it instead of keeping the old one', async ({
    page,
  }) => {
    const welcomeChannel = '123456789012345678';
    await page.goto('/settings?section=channels');
    await page.getByLabel('Welcome').fill(welcomeChannel);
    await page.getByRole('button', { name: 'Save channels' }).click();
    await expect(page.getByText('CHANNELS SAVED.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Welcome')).toHaveValue(welcomeChannel);
    await page.getByLabel('Welcome').fill('');
    await page.getByRole('button', { name: 'Save channels' }).click();
    await expect(page.getByText('CHANNELS SAVED.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Welcome')).toHaveValue('');
  });

  test('the audit log records the actions with escaped context', async ({ page }) => {
    await page.goto('/audit');
    const entries = page.getByRole('list', { name: 'Audit entries' });
    for (const action of [
      'settings.updated',
      'rank.verified_changed',
      'role.granted',
      'member.note_added',
      'auth.dev_login',
    ]) {
      await expect(entries.locator(`[data-action="${action}"]`).first()).toBeVisible();
    }
    await page.goto('/audit?action=settings.*&targetType=settings&targetId=branding');
    const settingsEntry = page.locator('[data-action="settings.updated"]').first();
    await settingsEntry.locator('summary').click();
    await expect(settingsEntry.locator('pre')).toContainText('"motto"');
    await expect(page.locator('[data-action="role.granted"]')).toHaveCount(0);

    const today = new Date().toISOString().slice(0, 10);
    await page.goto(`/audit?action=settings.*&since=${today}&until=${today}`);
    await expect(page.locator('[data-action="settings.updated"]').first()).toBeVisible();
    await page.goto('/audit?until=2000-01-01');
    await expect(page.getByText('NO MATCHING ENTRIES')).toBeVisible();
  });

  test('notifications can be marked read', async ({ page }) => {
    await page.goto('/notifications');
    await expect(page.getByText('SECURITY EVENT')).toBeVisible();
    await page.getByRole('button', { name: 'Mark all read' }).click();
    await expect(page.getByText('3 marked read.')).toBeVisible();
    await expect(page.getByTestId('unread-count')).toHaveCount(0);
    await page.goto('/notifications?filter=unread');
    await expect(page.getByText('ALL CAUGHT UP')).toBeVisible();
  });

  test('BREAK: markup in profile text is shown as text, never executed', async ({ page }) => {
    const payload = '<img src=x onerror="document.title=\'pwned\'">';
    let dialogs = 0;
    page.on('dialog', async (dialog) => {
      dialogs += 1;
      await dialog.dismiss();
    });
    await page.goto('/me');
    await page.getByLabel('Headline').fill(payload);
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Profile saved.')).toBeVisible();
    await page.goto('/members?q=Dev%20Founder');
    await page.getByRole('link', { name: /Dev Founder/ }).click();
    await expect(page.getByText(payload, { exact: true })).toBeVisible();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(await page.title()).not.toBe('pwned');
    expect(dialogs).toBe(0);

    await page.goto('/me');
    await page.getByLabel('Headline').fill('');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Profile saved.')).toBeVisible();
  });

  test('a claim is recorded as CLAIMED, and preferences save', async ({ page }) => {
    await page.goto('/me?tab=claims');
    await page.getByTestId('claim-body.physical').click();
    const dialog = page.getByRole('dialog', { name: 'Claim a rank' });
    await dialog.getByLabel('Claimed rank').selectOption('C');
    await dialog.getByLabel('Evidence title').fill('Half marathon, 1:34');
    await dialog.getByLabel('Evidence link').fill('javascript:alert(1)');
    await dialog.getByRole('button', { name: 'Record claim' }).click();
    // Rejected server-side (http(s) only): the dialog stays open with the error inline.
    await expect(dialog.getByRole('alert').filter({ hasText: 'http(s)' }).first()).toBeVisible();
    await dialog.getByLabel('Evidence link').fill('https://example.org/results');
    await dialog.getByRole('button', { name: 'Record claim' }).click();
    await expect(page.getByText(/CLAIM RECORDED — C/)).toBeVisible();

    await page.goto('/me?tab=preferences');
    await page.getByLabel('Time zone').selectOption('Europe/Berlin');
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(page.getByText('Preferences saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Time zone')).toHaveValue('Europe/Berlin');
  });
});
