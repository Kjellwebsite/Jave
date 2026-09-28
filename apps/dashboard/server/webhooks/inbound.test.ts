import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { anonymousActor, integrations, type ServiceContext, type UserActor } from '@jave/core';
import { createTestKit, type TestKit } from '@jave/core/testing';
import { type Database, rateLimitBuckets, webhookDeliveries } from '@jave/database';
import { isPublicPath } from '@/lib/routes';
import { handleInboundWebhook, readBodyCapped, WEBHOOK_RATE_LIMIT } from './inbound';

const GITHUB_SECRET = 'github-webhook-secret-for-dashboard-tests';
const CLIENT = 'client-key-a';
const OTHER_CLIENT = 'client-key-b';
const URL_BASE = 'http://localhost:3000/api/webhooks/';
const BYTE_ORDER_MARK = '﻿';

type StreamingInit = RequestInit & { duplex: 'half' };

let kit: TestKit;
let admin: UserActor;
let genericSecret: string;
let deliveryCounter = 0;

beforeEach(async () => {
  kit = await createTestKit({ encryptionKey: randomBytes(32).toString('base64') });
  admin = await kit.member({ roles: ['core'] });
  await integrations.createIntegration(kit.as(admin), {
    provider: 'github',
    name: 'GitHub',
    slug: 'github',
  });
  const generic = await integrations.createIntegration(kit.as(admin), {
    provider: 'generic',
    name: 'CI',
    slug: 'ci-hooks',
  });
  genericSecret = generic.signingSecret!;
});

afterEach(async () => {
  await kit.close();
});

function deps(
  overrides: Partial<{
    ctx: ServiceContext;
    githubSecret: string | undefined;
    clientKey: string;
  }> = {},
) {
  return {
    ctx: kit.as(anonymousActor),
    githubSecret: GITHUB_SECRET,
    clientKey: CLIENT,
    ...overrides,
  };
}

function githubRequest(
  body: string,
  options: { delivery?: string; secret?: string; signature?: string; contentType?: string } = {},
) {
  deliveryCounter++;
  return new Request(`${URL_BASE}github`, {
    method: 'POST',
    headers: {
      'Content-Type': options.contentType ?? 'application/json',
      'X-GitHub-Event': 'ping',
      'X-GitHub-Delivery': options.delivery ?? `gh-${deliveryCounter}`,
      'X-Hub-Signature-256':
        options.signature ?? integrations.signGithub(options.secret ?? GITHUB_SECRET, body),
    },
    body,
  });
}

function javeRequest(body: string, options: { timestamp?: number; delivery?: string } = {}) {
  deliveryCounter++;
  const timestamp = String(options.timestamp ?? Math.floor(kit.clock.now().getTime() / 1000));
  return new Request(`${URL_BASE}ci-hooks`, {
    method: 'POST',
    headers: {
      'x-jave-timestamp': timestamp,
      'x-jave-signature': integrations.signJave(genericSecret, timestamp, body),
      'x-jave-delivery': options.delivery ?? `jv-${deliveryCounter}`,
      'x-jave-event': 'deploy',
    },
    body,
  });
}

/** A body stream that records how many chunks were pulled from it. */
function countingStream(chunk: Uint8Array, chunks: number) {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled >= chunks) return controller.close();
      state.pulled++;
      controller.enqueue(chunk);
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

describe('POST /api/webhooks/github', () => {
  it('accepts a valid signature and stores the raw payload', async () => {
    const body = JSON.stringify({ zen: 'Keep it logically awesome.', hook_id: 1 });
    const response = await handleInboundWebhook(githubRequest(body), 'github', deps());
    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const json = (await response.json()) as { ok: boolean; deliveryId: string };
    expect(json.ok).toBe(true);
    const [row] = await kit.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, json.deliveryId));
    expect(row).toMatchObject({
      eventType: 'ping',
      payload: { zen: 'Keep it logically awesome.' },
    });
  });

  it('BREAK: refuses a wrong or missing signature', async () => {
    const body = JSON.stringify({ zen: 'x' });
    const forged = await handleInboundWebhook(
      githubRequest(body, { secret: 'not-the-deployment-secret' }),
      'github',
      deps(),
    );
    expect(forged.status).toBe(401);
    expect(await forged.json()).toEqual({ error: 'invalid_signature' });
    const tampered = await handleInboundWebhook(
      githubRequest(body, { signature: integrations.signGithub(GITHUB_SECRET, `${body} `) }),
      'github',
      deps(),
    );
    expect(tampered.status).toBe(401);
    expect(await kit.db.select().from(webhookDeliveries)).toHaveLength(0);
  });

  it('answers a redelivery as a duplicate without reprocessing', async () => {
    const body = JSON.stringify({ zen: 'once' });
    const first = await handleInboundWebhook(
      githubRequest(body, { delivery: 'gh-dup' }),
      'github',
      deps(),
    );
    expect(first.status).toBe(202);
    const again = await handleInboundWebhook(
      githubRequest(body, { delivery: 'gh-dup' }),
      'github',
      deps(),
    );
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, duplicate: true });
    const replayedWithNewId = await handleInboundWebhook(
      githubRequest(body, { delivery: 'gh-forged-id' }),
      'github',
      deps(),
    );
    expect(await replayedWithNewId.json()).toEqual({ ok: true, duplicate: true });
    expect(await kit.db.select().from(webhookDeliveries)).toHaveLength(1);
  });

  it("accepts GitHub's default form content type (payload=<url-encoded JSON>)", async () => {
    const payload = { zen: 'Half measures are as bad as nothing at all.', hook_id: 2 };
    const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
    const response = await handleInboundWebhook(
      githubRequest(body, { contentType: 'application/x-www-form-urlencoded' }),
      'github',
      deps(),
    );
    expect(response.status).toBe(202);
    const [row] = await kit.db.select().from(webhookDeliveries);
    expect(row).toMatchObject({ eventType: 'ping', payload });
  });

  it('BREAK: a signed delivery that cannot be read is surfaced as the last error', async () => {
    const response = await handleInboundWebhook(
      githubRequest('payload=%7Bbroken', { contentType: 'application/x-www-form-urlencoded' }),
      'github',
      deps(),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'malformed_json' });
    const [github] = (await integrations.listIntegrations(kit.as(admin))).filter(
      (integration) => integration.slug === 'github',
    );
    expect(github!.lastError).toBe('delivery rejected: malformed_json');
    expect(await kit.db.select().from(webhookDeliveries)).toHaveLength(0);
  });

  it('answers 503 when the deployment has no GitHub secret', async () => {
    const response = await handleInboundWebhook(
      githubRequest('{}'),
      'github',
      deps({ githubSecret: undefined }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'not_configured' });
  });
});

describe('POST /api/webhooks/[slug] (JAVE v1)', () => {
  it('accepts a valid timestamped signature', async () => {
    const response = await handleInboundWebhook(
      javeRequest('{"text":"green"}'),
      'ci-hooks',
      deps(),
    );
    expect(response.status).toBe(202);
  });

  it('BREAK: refuses replays outside the window and duplicates inside it', async () => {
    const stale = Math.floor(kit.clock.now().getTime() / 1000) - 3600;
    const replay = await handleInboundWebhook(
      javeRequest('{"text":"old"}', { timestamp: stale }),
      'ci-hooks',
      deps(),
    );
    expect(replay.status).toBe(401);
    const request = () => javeRequest('{"text":"fresh"}', { delivery: 'jv-fixed' });
    expect((await handleInboundWebhook(request(), 'ci-hooks', deps())).status).toBe(202);
    const duplicate = await handleInboundWebhook(request(), 'ci-hooks', deps());
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toEqual({ ok: true, duplicate: true });
  });

  it('verifies the raw bytes: a byte-order mark is kept, not stripped', async () => {
    const body = `${BYTE_ORDER_MARK}{"text":"bom"}`;
    const response = await handleInboundWebhook(javeRequest(body), 'ci-hooks', deps());
    // Signature verified over the exact bytes; the JSON itself is then malformed.
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'malformed_json' });
  });

  it('BREAK: unknown, malformed and disabled slugs are indistinguishable 404s', async () => {
    for (const slug of ['nope-nope', '../../etc', 'A'.repeat(300)]) {
      const response = await handleInboundWebhook(javeRequest('{}'), slug, deps());
      expect(response.status, slug).toBe(404);
      expect(await response.json()).toEqual({ error: 'not_found' });
    }
    const [ci] = await integrations
      .listIntegrations(kit.as(admin))
      .then((all) => all.filter((integration) => integration.slug === 'ci-hooks'));
    await integrations.setIntegrationEnabled(kit.as(admin), {
      integrationId: ci!.id,
      enabled: false,
    });
    const disabled = await handleInboundWebhook(javeRequest('{}'), 'ci-hooks', deps());
    expect(disabled.status).toBe(404);
  });
});

describe('size cap', () => {
  it('BREAK: refuses a declared oversize body before reading it', async () => {
    const { stream, state } = countingStream(new Uint8Array(1024), 4);
    const init: StreamingInit = {
      method: 'POST',
      headers: { 'content-length': String(integrations.MAX_WEBHOOK_BODY_BYTES + 1) },
      body: stream,
      duplex: 'half',
    };
    const request = new Request(`${URL_BASE}github`, init);
    const response = await handleInboundWebhook(request, 'github', deps());
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'payload_too_large' });
    expect(state.pulled).toBeLessThanOrEqual(1);
  });

  it('BREAK: stops reading an undeclared stream once it passes the cap', async () => {
    const chunkSize = 64 * 1024;
    const chunks = 64;
    const { stream, state } = countingStream(new Uint8Array(chunkSize).fill(32), chunks);
    const init: StreamingInit = { method: 'POST', body: stream, duplex: 'half' };
    const request = new Request(`${URL_BASE}github`, init);
    const response = await handleInboundWebhook(request, 'github', deps());
    expect(response.status).toBe(413);
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThan(chunks);
    expect(state.pulled * chunkSize).toBeLessThanOrEqual(
      integrations.MAX_WEBHOOK_BODY_BYTES + 2 * chunkSize,
    );
  });

  it('reads bodies at the cap exactly', async () => {
    const text = 'x'.repeat(integrations.MAX_WEBHOOK_BODY_BYTES);
    const read = await readBodyCapped(
      new Request(URL_BASE, { method: 'POST', body: text }),
      integrations.MAX_WEBHOOK_BODY_BYTES,
    );
    expect(read).toEqual({ ok: true, text });
  });
});

describe('rate limit', () => {
  it('BREAK: limits each sender per slug, independently of other senders', async () => {
    for (let i = 0; i < WEBHOOK_RATE_LIMIT.limit; i++) {
      const response = await handleInboundWebhook(
        githubRequest('{}', { secret: 'wrong' }),
        'github',
        deps(),
      );
      expect(response.status).toBe(401);
    }
    const limited = await handleInboundWebhook(githubRequest('{}'), 'github', deps());
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    const otherSender = await handleInboundWebhook(
      githubRequest('{"zen":"ok"}'),
      'github',
      deps({ clientKey: OTHER_CLIENT }),
    );
    expect(otherSender.status).toBe(202);
    const otherSlug = await handleInboundWebhook(javeRequest('{}'), 'ci-hooks', deps());
    expect(otherSlug.status).toBe(202);
  });
});

describe('rate limit: invented slugs', () => {
  it('BREAK: rotating unknown slugs neither escapes the flood limit nor adds a row per slug', async () => {
    const bucketCount = async () => (await kit.db.select().from(rateLimitBuckets)).length;
    const before = await bucketCount();
    for (let i = 0; i < WEBHOOK_RATE_LIMIT.limit; i++) {
      const response = await handleInboundWebhook(javeRequest('{}'), `probe-${i}-x`, deps());
      expect(response.status).toBe(404);
    }
    // All unknown slugs share one bucket per sender: the next one is throttled.
    const limited = await handleInboundWebhook(javeRequest('{}'), 'probe-final-x', deps());
    expect(limited.status).toBe(429);
    // One sender-wide bucket and one unknown-slug bucket, not one per invented slug.
    expect((await bucketCount()) - before).toBe(2);
    // A real integration still has its own budget for the same sender.
    const real = await handleInboundWebhook(javeRequest('{}'), 'ci-hooks', deps());
    expect(real.status).toBe(202);
  });
});

describe('failure handling', () => {
  it('BREAK: unexpected failures return only a reference', async () => {
    const broken = new Proxy(
      {},
      {
        get() {
          throw new Error('connection refused: postgres://jave:hunter2@db');
        },
      },
    ) as unknown as Database;
    const ctx = { ...kit.as(anonymousActor), db: broken, rootDb: broken };
    const response = await handleInboundWebhook(githubRequest('{}'), 'github', deps({ ctx }));
    expect(response.status).toBe(500);
    const body = (await response.json()) as Record<string, string>;
    expect(Object.keys(body).sort()).toEqual(['error', 'reference']);
    expect(body.reference).toMatch(/^E-[A-Z0-9]{8}$/);
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });

  it('webhook routes bypass the session gate', () => {
    expect(isPublicPath('/api/webhooks/github')).toBe(true);
    expect(isPublicPath('/api/webhooks/ci-hooks')).toBe(true);
    expect(isPublicPath('/api/webhooksx')).toBe(false);
  });
});
