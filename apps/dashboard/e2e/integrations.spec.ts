import { createHmac } from 'node:crypto';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { E2E_GITHUB_WEBHOOK_SECRET } from './deployment-secrets';
import { signInAs } from './fixtures';

/**
 * Integrations end to end: registry, secrets shown once, the real inbound
 * webhook routes (signature, replay, duplicates, disable → 404), the delivery
 * log with escaped payloads, and outbound webhook CRUD.
 */
test.describe.configure({ mode: 'serial' });

const SLUG = 'ci-hooks';
const HOSTILE = '<script>window.__pwned = true</script>';
let secret = '';
let deliveryCounter = 0;

/** JAVE v1: X-Jave-Signature: v1=hex(HMAC-SHA256(secret, "<timestamp>.<body>")). */
function javeHeaders(signingSecret: string, body: string, delivery: string, timestamp?: number) {
  const ts = String(timestamp ?? Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', signingSecret).update(`${ts}.${body}`).digest('hex');
  return {
    'content-type': 'application/json',
    'x-jave-timestamp': ts,
    'x-jave-signature': `v1=${signature}`,
    'x-jave-delivery': delivery,
    'x-jave-event': 'deploy',
  };
}

async function postJave(
  request: APIRequestContext,
  signingSecret: string,
  body: string,
  options: { delivery?: string; timestamp?: number } = {},
) {
  deliveryCounter++;
  return request.post(`/api/webhooks/${SLUG}`, {
    headers: javeHeaders(signingSecret, body, options.delivery ?? `e2e-${deliveryCounter}`, options.timestamp),
    data: body,
  });
}

async function readSecretAndClose(page: Page): Promise<string> {
  const field = page.getByTestId('signing-secret');
  await expect(field).toBeVisible();
  const value = await field.inputValue();
  expect(value).toMatch(/^whsec_/);
  await page.getByRole('button', { name: 'I stored it' }).click();
  await expect(field).toBeHidden();
  return value;
}

test('BREAK: members cannot open integrations', async ({ page }) => {
  await signInAs(page, 'member');
  await expect(page.getByRole('link', { name: 'Integrations' })).toHaveCount(0);
  await page.goto('/integrations');
  await expect(page.getByText('ACCESS RESTRICTED')).toBeVisible();
  await expect(page.getByText('canManageIntegrations')).toBeVisible();
});

test('core registers a generic integration; the secret is shown exactly once', async ({ page }) => {
  await signInAs(page, 'core');
  await page.goto('/integrations');
  await expect(page.getByText('NO INTEGRATIONS')).toBeVisible();

  await page.getByTestId('add-integration').click();
  const dialog = page.getByRole('dialog', { name: 'Add integration' });
  await dialog.getByLabel('Provider').selectOption('generic');
  await dialog.getByLabel('Name').fill('CI pipeline');
  await dialog.getByLabel('Slug').fill(SLUG);
  await dialog.getByRole('button', { name: 'Create integration' }).click();
  secret = await readSecretAndClose(page);

  const row = page.locator(`[data-integration="${SLUG}"]`);
  await expect(row).toContainText('CI pipeline');
  await expect(row.getByRole('textbox', { name: 'Endpoint URL' })).toHaveValue(/\/api\/webhooks\/ci-hooks$/);
  // The secret never renders again.
  await page.reload();
  await expect(page.getByText(secret)).toHaveCount(0);
  expect(await page.content()).not.toContain(secret);

  await page.getByTestId('add-integration').click();
  const duplicate = page.getByRole('dialog', { name: 'Add integration' });
  await duplicate.getByLabel('Name').fill('Second');
  await duplicate.getByLabel('Slug').fill(SLUG);
  await duplicate.getByRole('button', { name: 'Create integration' }).click();
  await expect(duplicate.getByText('That slug is already in use.')).toBeVisible();
});

test('the inbound route verifies signatures, refuses replays and dedupes', async ({ request }) => {
  const body = JSON.stringify({ text: HOSTILE, run: 42 });
  const accepted = await postJave(request, secret, body, { delivery: 'e2e-accepted' });
  expect(accepted.status()).toBe(202);
  expect(await accepted.json()).toMatchObject({ ok: true });

  const duplicate = await postJave(request, secret, body, { delivery: 'e2e-accepted' });
  expect(duplicate.status()).toBe(200);
  expect(await duplicate.json()).toMatchObject({ ok: true, duplicate: true });

  const forged = await postJave(request, 'whsec_not-the-secret', body);
  expect(forged.status()).toBe(401);

  const stale = await postJave(request, secret, JSON.stringify({ text: 'old' }), {
    timestamp: Math.floor(Date.now() / 1000) - 3600,
  });
  expect(stale.status()).toBe(401);

  const unknown = await request.post('/api/webhooks/no-such-hook', { data: '{}' });
  expect(unknown.status()).toBe(404);

  const tooLarge = await request.post(`/api/webhooks/${SLUG}`, {
    headers: { 'content-type': 'application/json' },
    data: 'x'.repeat(1024 * 1024 + 1),
  });
  expect(tooLarge.status()).toBe(413);
});

test('GitHub deliveries use the deployment secret', async ({ page, request }) => {
  await signInAs(page, 'core');
  await page.goto('/integrations');
  await page.getByTestId('add-integration').click();
  const dialog = page.getByRole('dialog', { name: 'Add integration' });
  await dialog.getByLabel('Provider').selectOption('github');
  await dialog.getByLabel('Name').fill('GitHub');
  await dialog.getByLabel('Slug').fill('github');
  await dialog.getByRole('button', { name: 'Create integration' }).click();
  await expect(page.getByText(/INTEGRATION CREATED — GitHub — .*GITHUB_WEBHOOK_SECRET/)).toBeVisible();
  await expect(page.locator('[data-integration="github"]')).toContainText('GITHUB_WEBHOOK_SECRET');

  const body = JSON.stringify({ zen: 'Design for failure.', hook_id: 1 });
  const signature = createHmac('sha256', E2E_GITHUB_WEBHOOK_SECRET).update(body).digest('hex');
  const ping = await request.post('/api/webhooks/github', {
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'ping',
      'x-github-delivery': 'e2e-github-ping-1',
      'x-hub-signature-256': `sha256=${signature}`,
    },
    data: body,
  });
  expect(ping.status()).toBe(202);
  const forged = await request.post('/api/webhooks/github', {
    headers: {
      'x-github-event': 'ping',
      'x-github-delivery': 'e2e-github-ping-2',
      'x-hub-signature-256': `sha256=${'0'.repeat(64)}`,
    },
    data: body,
  });
  expect(forged.status()).toBe(401);
});

test('the delivery log shows statuses and escaped, collapsed payloads', async ({ page }) => {
  await signInAs(page, 'core');
  await page.goto('/integrations?tab=deliveries');
  const row = page.locator('[data-delivery="e2e-accepted"]');
  await expect(row).toContainText('deploy');
  await expect(row).toContainText('RECEIVED');
  await row.getByRole('link').click();
  await expect(page).toHaveURL(/delivery=/);
  const payload = page.getByTestId('delivery-payload');
  await expect(payload).toBeHidden();
  await page.getByText(/Payload · \d+ characters/).click();
  await expect(payload).toContainText(HOSTILE);
  expect(await page.evaluate(() => (window as { __pwned?: boolean }).__pwned)).toBeUndefined();
  await expect(page.getByTestId('retry-delivery')).toHaveCount(0);
});

test('rotating the secret retires the old one; disabling answers 404', async ({ page, request }) => {
  await signInAs(page, 'core');
  await page.goto('/integrations');
  const row = page.locator(`[data-integration="${SLUG}"]`);
  await row.getByRole('button', { name: 'Rotate' }).click();
  await page.getByRole('dialog', { name: /Rotate secret/ }).getByRole('button', { name: 'Rotate secret' }).click();
  const rotated = await readSecretAndClose(page);
  expect(rotated).not.toBe(secret);

  const body = JSON.stringify({ text: 'after rotation' });
  expect((await postJave(request, secret, body)).status()).toBe(401);
  expect((await postJave(request, rotated, body)).status()).toBe(202);

  await row.getByRole('button', { name: 'Disable' }).click();
  await page.getByRole('dialog', { name: /Disable/ }).getByRole('button', { name: 'Disable integration' }).click();
  await expect(page.getByText(/INTEGRATION DISABLED — CI pipeline/)).toBeVisible();
  expect((await postJave(request, rotated, JSON.stringify({ text: 'while off' }))).status()).toBe(404);

  await row.getByRole('button', { name: 'Enable' }).click();
  await expect(page.getByText(/INTEGRATION ENABLED — CI pipeline/)).toBeVisible();
  expect((await postJave(request, rotated, JSON.stringify({ text: 'back on' }))).status()).toBe(202);
});

test('outbound webhooks: create with the event picker, refuse unsafe targets, edit and delete', async ({
  page,
}) => {
  await signInAs(page, 'core');
  await page.goto('/integrations?tab=outbound');
  await expect(page.getByText('NO OUTBOUND WEBHOOKS')).toBeVisible();

  await page.getByTestId('add-webhook').click();
  const dialog = page.getByRole('dialog', { name: 'Add webhook' });
  await dialog.getByLabel('Name', { exact: true }).fill('Analytics sink');
  await dialog.getByLabel('URL', { exact: true }).fill('https://127.0.0.1/hook');
  // Internal events are never offered.
  await expect(dialog.getByText('member.profile_updated')).toHaveCount(0);
  await dialog.getByRole('checkbox', { name: 'project.created' }).check();
  await dialog.getByRole('checkbox', { name: 'project.shipped' }).check();
  await dialog.getByRole('button', { name: 'Create webhook' }).click();
  await expect(dialog.getByText(/Webhook URL rejected/)).toBeVisible();

  await dialog.getByLabel('URL', { exact: true }).fill('https://hooks.example.com/jave/secret-path-token');
  await dialog.getByRole('button', { name: 'Create webhook' }).click();
  await readSecretAndClose(page);

  const row = page.locator('[data-webhook="Analytics sink"]');
  await expect(row).toContainText('https://hooks.example.com/…');
  await expect(row).not.toContainText('secret-path-token');
  await expect(row).toContainText('2 events');

  await row.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Analytics sink' });
  await expect(edit.getByRole('checkbox', { name: 'project.created' })).toBeChecked();
  await edit.getByRole('checkbox', { name: 'project.shipped' }).uncheck();
  await edit.getByRole('button', { name: 'Save webhook' }).click();
  await expect(page.getByText('WEBHOOK UPDATED — Analytics sink.')).toBeVisible();
  await expect(row).toContainText('1 event');

  await page.goto('/integrations?tab=outbound-log');
  await expect(page.getByText('NO DELIVERIES YET')).toBeVisible();

  await page.goto('/integrations?tab=outbound');
  await page.locator('[data-webhook="Analytics sink"]').getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog', { name: 'Delete Analytics sink' }).getByRole('button', { name: 'Delete webhook' }).click();
  await expect(page.getByText('WEBHOOK DELETED — queued deliveries are skipped.')).toBeVisible();
  await expect(page.getByText('NO OUTBOUND WEBHOOKS')).toBeVisible();
});
