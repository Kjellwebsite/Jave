import { expect, test } from '@playwright/test';
import { signInAs } from './fixtures';

test.describe('access and security', () => {
  test('signed-out visitors are sent to /login and keep their destination', async ({ page }) => {
    await page.goto('/members?role=core');
    await expect(page).toHaveURL(/\/login\?next=%2Fmembers%3Frole%3Dcore/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByText('DEV LOGIN — MOCK / DEVELOPMENT ONLY')).toBeVisible();
  });

  test('pages carry strict security headers', async ({ request }) => {
    const response = await request.get('/login');
    const headers = response.headers();
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('camera=()');
    const csp = headers['content-security-policy']!;
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(headers['strict-transport-security']).toMatch(/^max-age=\d+; includeSubDomains$/);
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('an unknown address is a 404 whose every script carries the CSP nonce', async ({ page }) => {
    await signInAs(page, 'member');
    const response = await page.goto('/no-such-page');
    expect(response?.status()).toBe(404);
    await expect(page.getByText('NOT FOUND')).toBeVisible();
    const nonce = /'nonce-([^']+)'/.exec(response!.headers()['content-security-policy']!)?.[1];
    expect(nonce).toBeTruthy();
    const scripts = (await response!.text()).match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag).toContain(`nonce="${nonce}"`);
  });

  test('health reports the database', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'ok',
      checks: [{ name: 'database', status: 'ok' }],
    });
  });

  test('a public profile renders signed out, with OpenGraph metadata', async ({ page }) => {
    await page.goto('/p/mara');
    await expect(page.getByRole('heading', { level: 1, name: 'Mara Voss' })).toBeVisible();
    await expect(page.getByText('JVLN PROFILE', { exact: true })).toBeVisible();
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      'content',
      'Mara Voss — JVLN PROFILE',
    );
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
      'content',
      /VERIFIED · MIND S · CREATE S/,
    );
    const domains = page.getByRole('region', { name: 'Capability by domain' });
    await expect(domains.locator('[data-rank-status="verified"]:visible')).toHaveCount(3);
    await expect(domains.locator('[data-rank-status="claimed"]:visible')).toHaveCount(2);
  });

  test('BREAK: members-only and unknown profiles are indistinguishable 404s when signed out', async ({
    page,
  }) => {
    for (const handle of ['ilya', 'nobody-here', '..%2Fadmin']) {
      const response = await page.goto(`/p/${handle}`);
      expect(response?.status(), handle).toBe(404);
      await expect(page.getByText('NOT FOUND')).toBeVisible();
    }
  });

  test('BREAK: a forged session cookie is not a session', async ({ page, context }) => {
    await context.addCookies([
      { name: 'jave_session', value: 'A'.repeat(43), url: 'http://localhost:3107' },
    ]);
    await page.goto('/overview');
    await expect(page).toHaveURL(/\/login/);
  });

  test('BREAK: a cross-origin replay of a Server Action does not sign anyone in', async ({
    request,
  }) => {
    const html = await (await request.get('/login')).text();
    const actionField = /name="(\$ACTION_ID_[0-9a-f]+)"/.exec(html)?.[1];
    expect(actionField).toBeTruthy();
    const response = await request.post('/login', {
      headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
      multipart: { [actionField!]: '', persona: 'founder', next: '/overview' },
      maxRedirects: 0,
    });
    const setCookie = response
      .headersArray()
      .filter((header) => header.name.toLowerCase() === 'set-cookie');
    expect(
      setCookie.some(
        (header) =>
          header.value.startsWith('jave_session=') && !header.value.startsWith('jave_session=;'),
      ),
    ).toBe(false);
  });

  test('a member sees ACCESS RESTRICTED for settings and audit, and no staff navigation', async ({
    page,
  }) => {
    await signInAs(page, 'member');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('link', { name: 'Members' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Audit Log' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Settings' })).toHaveCount(0);

    await page.goto('/settings');
    await expect(page.getByText('ACCESS RESTRICTED')).toBeVisible();
    await expect(page.getByText('canViewSettings')).toBeVisible();
    await page.goto('/audit');
    await expect(page.getByText('ACCESS RESTRICTED')).toBeVisible();
    await expect(page.getByText('canViewAuditLogs')).toBeVisible();
  });

  test('a member cannot see evaluator or role controls on another member', async ({ page }) => {
    await signInAs(page, 'member');
    await page.goto('/members?q=Mara');
    await page.getByRole('link', { name: /Mara Voss/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Mara Voss' })).toBeVisible();
    await expect(page.locator('[data-testid^="set-rank-"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Staff notes' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Roles' }).click();
    await expect(page.getByText('Roles are read-only for you.')).toBeVisible();
    await expect(page.getByTestId('grant-role')).toHaveCount(0);
  });

  test('operations can read settings but not change them', async ({ page }) => {
    await signInAs(page, 'operations');
    await page.goto('/settings');
    await expect(page.getByText('READ-ONLY')).toBeVisible();
    await expect(page.getByLabel('Motto')).toBeDisabled();
    await expect(page.getByRole('button', { name: /Save/ })).toHaveCount(0);
  });

  test('signing out revokes the session', async ({ page, context }) => {
    await signInAs(page, 'verified');
    const before = (await context.cookies()).find((cookie) => cookie.name === 'jave_session');
    expect(before?.httpOnly).toBe(true);
    expect(before?.sameSite).toBe('Lax');
    await page.getByRole('button', { name: /Account menu/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await page.waitForURL('**/login');
    await context.addCookies([
      { name: 'jave_session', value: before!.value, url: 'http://localhost:3107' },
    ]);
    await page.goto('/overview');
    await expect(page).toHaveURL(/\/login/);
  });
});
