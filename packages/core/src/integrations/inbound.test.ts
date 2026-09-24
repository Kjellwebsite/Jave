import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  auditLogs,
  contributions,
  domainEvents,
  integrations,
  jobs,
  webhookDeliveries,
} from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { ForbiddenError } from '../kernel/errors';
import { anonymousActor, type UserActor } from '../permissions/actor';
import { updateSettings } from '../settings/settings.service';
import { createProject, linkGithubRepo } from '../projects';
import {
  INVALID_SIGNATURE_AUDIT_WINDOW_SECONDS,
  INVALID_SIGNATURE_AUDITS_PER_WINDOW,
  MAX_WEBHOOK_BODY_BYTES,
  PROCESS_DELIVERY_JOB,
  REPLAY_WINDOW_MS,
} from './constants';
import {
  DISCORD_INTEGRATIONS_RELAY_JOB,
  markRelayDelivered,
  markRelayFailed,
} from './discord-jobs';
import { linkGithubAccount, setExternalAccountVerification } from './external-accounts.service';
import { createIntegrationJobHandlers, DEFAULT_PROCESSORS } from './handlers';
import { receiveWebhook } from './inbound.service';
import { createIntegration, retryWebhookDelivery, setIntegrationEnabled } from './registry.service';
import { signGithub, signJave } from './signatures';
import { testEncryptionKey } from './testing/fakes';
import {
  DB_HOOK_TIMEOUT_MS,
  DB_TEST_TIMEOUT_MS,
  WARM_UP_TIMEOUT_MS,
  warmTestDatabase,
} from '../projects/testing/warm-up';

const GITHUB_SECRET = 'github-webhook-secret-for-tests';

beforeAll(warmTestDatabase, WARM_UP_TIMEOUT_MS);

describe('inbound webhooks', { timeout: DB_TEST_TIMEOUT_MS }, () => {
  let kit: TestKit;
  let admin: UserActor;
  let dev: UserActor;
  let genericSecret: string;
  const handlers = createIntegrationJobHandlers();

  beforeEach(async () => {
    kit = await createTestKit({ encryptionKey: testEncryptionKey() });
    admin = await kit.member({ roles: ['core'], username: 'admin' });
    dev = await kit.member({ username: 'octodev' });
    await createIntegration(kit.as(admin), { provider: 'github', name: 'GitHub', slug: 'github' });
    const generic = await createIntegration(kit.as(admin), {
      provider: 'generic',
      name: 'CI',
      slug: 'ci-hooks',
      config: { relayChannelId: '123456789012345678' },
    });
    genericSecret = generic.signingSecret!;
  }, DB_HOOK_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  });

  const anon = () => kit.as(anonymousActor);
  let deliveryCounter = 0;

  function github(
    event: string,
    payload: unknown,
    options: { delivery?: string; secret?: string; slug?: string } = {},
  ) {
    const rawBody = JSON.stringify(payload);
    deliveryCounter++;
    return receiveWebhook(anon(), {
      slug: options.slug ?? 'github',
      rawBody,
      headers: {
        'X-Hub-Signature-256': signGithub(options.secret ?? GITHUB_SECRET, rawBody),
        'x-github-delivery': options.delivery ?? `guid-${deliveryCounter}`,
        'x-github-event': event,
      },
      secrets: { github: GITHUB_SECRET },
    });
  }

  function generic(
    payload: unknown,
    options: { timestamp?: number; delivery?: string; body?: string } = {},
  ) {
    const rawBody = options.body ?? JSON.stringify(payload);
    const timestamp = String(options.timestamp ?? Math.floor(kit.clock.now().getTime() / 1000));
    deliveryCounter++;
    return receiveWebhook(anon(), {
      slug: 'ci-hooks',
      rawBody,
      headers: {
        'x-jave-timestamp': timestamp,
        'x-jave-signature': signJave(genericSecret, timestamp, rawBody),
        'x-jave-delivery': options.delivery ?? `d-${deliveryCounter}`,
        'x-jave-event': 'deploy',
      },
      secrets: {},
    });
  }

  async function linkedProject() {
    const project = await createProject(kit.as(dev), { title: 'Engine', visibility: 'public' });
    await linkGithubRepo(kit.as(dev), { projectId: project.id, repo: 'javelin/engine' });
    await linkGithubAccount(kit.as(dev), { username: 'OctoDev' });
    return project;
  }

  function mergedPr(number: number, overrides: Record<string, unknown> = {}) {
    return {
      action: 'closed',
      number,
      pull_request: {
        merged: true,
        merged_at: '2026-02-28T10:00:00Z',
        title: `Faster parser\u0000 @everyone`,
        html_url: `https://github.com/Javelin/Engine/pull/${number}`,
        user: { login: 'octodev', id: 4242, type: 'User' },
      },
      repository: { full_name: 'Javelin/Engine', default_branch: 'main' },
      ...overrides,
    };
  }

  describe('receiving', () => {
    it('accepts a signed GitHub delivery, stores it and enqueues processing', async () => {
      const response = await github('ping', { zen: 'Design for failure.' });
      expect(response.status).toBe(202);
      const [delivery] = await kit.db.select().from(webhookDeliveries);
      expect(delivery).toMatchObject({ provider: 'github', eventType: 'ping', status: 'received' });
      const queued = await kit.db.select().from(jobs).where(eq(jobs.type, PROCESS_DELIVERY_JOB));
      expect(queued).toHaveLength(1);
      await kit.drain(handlers);
      const [processed] = await kit.db.select().from(webhookDeliveries);
      expect(processed).toMatchObject({ status: 'processed', statusReason: 'ping acknowledged' });
    });

    it('BREAK: invalid signature → 401, durable audit, nothing stored', async () => {
      const response = await github('ping', { zen: 'x' }, { secret: 'wrong-secret' });
      expect(response).toEqual({ status: 401, body: { error: 'invalid_signature' } });
      expect(await kit.db.select().from(webhookDeliveries)).toHaveLength(0);
      const [audit] = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'webhook.signature_invalid'));
      expect(audit).toMatchObject({ result: 'denied' });
      expect(audit!.context).toMatchObject({ reason: 'signature_mismatch', slug: 'github' });
      const [integration] = await kit.db
        .select()
        .from(integrations)
        .where(eq(integrations.slug, 'github'));
      expect(integration!.lastError).toBe('signature rejected: signature_mismatch');
    });

    it('BREAK: duplicate delivery id → 200 duplicate with no reprocessing', async () => {
      const first = await github('ping', { zen: 'a' }, { delivery: 'same-guid' });
      const second = await github('ping', { zen: 'a' }, { delivery: 'same-guid' });
      expect(first.status).toBe(202);
      expect(second).toEqual({ status: 200, body: { ok: true, duplicate: true } });
      expect(await kit.db.select().from(webhookDeliveries)).toHaveLength(1);
      expect(
        await kit.db.select().from(jobs).where(eq(jobs.type, PROCESS_DELIVERY_JOB)),
      ).toHaveLength(1);
    });

    it('BREAK: a captured request replayed with a new delivery id is still a duplicate', async () => {
      await generic({ text: 'deploy' }, { delivery: 'original' });
      const replay = await generic({ text: 'deploy' }, { delivery: 'forged-new-id' });
      expect(replay.body).toEqual({ ok: true, duplicate: true });
    });

    it('BREAK: GitHub idempotency is deployment-wide (one shared secret)', async () => {
      await createIntegration(kit.as(admin), {
        provider: 'github',
        name: 'GitHub org',
        slug: 'github-org',
      });
      await github('ping', { zen: 'a' }, { delivery: 'guid-shared' });
      const sameDelivery = await github(
        'ping',
        { zen: 'b' },
        { delivery: 'guid-shared', slug: 'github-org' },
      );
      const sameBody = await github(
        'ping',
        { zen: 'a' },
        { delivery: 'guid-forged', slug: 'github-org' },
      );
      const fresh = await github('ping', { zen: 'c' }, { slug: 'github-org' });
      expect(sameDelivery.body).toEqual({ ok: true, duplicate: true });
      expect(sameBody.body).toEqual({ ok: true, duplicate: true });
      expect(fresh.status).toBe(202);
      expect(await kit.db.select().from(webhookDeliveries)).toHaveLength(2);
    });

    it('delivery ids of JAVE-signed senders are scoped to their integration', async () => {
      const other = await createIntegration(kit.as(admin), {
        provider: 'generic',
        name: 'Other CI',
        slug: 'other-ci',
      });
      await generic({ text: 'one' }, { delivery: '1' });
      const rawBody = JSON.stringify({ text: 'two' });
      const timestamp = String(Math.floor(kit.clock.now().getTime() / 1000));
      const response = await receiveWebhook(anon(), {
        slug: 'other-ci',
        rawBody,
        headers: {
          'x-jave-timestamp': timestamp,
          'x-jave-signature': signJave(other.signingSecret!, timestamp, rawBody),
          'x-jave-delivery': '1',
        },
        secrets: {},
      });
      expect(response.status).toBe(202);
    });

    it('BREAK: stale or future timestamps are rejected as replays', async () => {
      const now = Math.floor(kit.clock.now().getTime() / 1000);
      const window = REPLAY_WINDOW_MS / 1000;
      expect((await generic({ a: 1 }, { timestamp: now - window - 1 })).status).toBe(401);
      expect((await generic({ a: 1 }, { timestamp: now + window + 1 })).status).toBe(401);
      expect((await generic({ a: 1 }, { timestamp: now - window + 5 })).status).toBe(202);
      const reasons = (
        await kit.db
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.action, 'webhook.signature_invalid'))
      ).map((row) => row.context.reason);
      expect(reasons).toEqual(['timestamp_out_of_range', 'timestamp_out_of_range']);
    });

    it('BREAK: oversize bodies → 413 before any verification', async () => {
      const huge = 'x'.repeat(MAX_WEBHOOK_BODY_BYTES + 1);
      const response = await generic(null, { body: huge });
      expect(response.status).toBe(413);
      const multibyte = 'é'.repeat(MAX_WEBHOOK_BODY_BYTES / 2 + 1);
      expect((await generic(null, { body: multibyte })).status).toBe(413);
      expect(
        await kit.db
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.action, 'webhook.signature_invalid')),
      ).toHaveLength(0);
    });

    it('BREAK: malformed JSON (validly signed) → 400', async () => {
      expect(await generic(null, { body: '{"unterminated": ' })).toEqual({
        status: 400,
        body: { error: 'malformed_json' },
      });
      expect((await generic(null, { body: '[1,2,3]' })).body).toEqual({ error: 'not_an_object' });
    });

    it('BREAK: unknown, malformed and disabled slugs all look the same (404)', async () => {
      const probe = (slug: string) =>
        receiveWebhook(anon(), { slug, rawBody: '{}', headers: {}, secrets: {} });
      expect((await probe('nope')).status).toBe(404);
      expect((await probe('../../etc')).status).toBe(404);
      const [ci] = await kit.db
        .select()
        .from(integrations)
        .where(eq(integrations.slug, 'ci-hooks'));
      await setIntegrationEnabled(kit.as(admin), { integrationId: ci!.id, enabled: false });
      expect((await generic({ a: 1 })).status).toBe(404);
    });

    it('BREAK: missing delivery headers → 400; unconfigured GitHub secret → 503', async () => {
      const rawBody = '{}';
      const noDelivery = await receiveWebhook(anon(), {
        slug: 'github',
        rawBody,
        headers: {
          'x-hub-signature-256': signGithub(GITHUB_SECRET, rawBody),
          'x-github-event': 'ping',
        },
        secrets: { github: GITHUB_SECRET },
      });
      expect(noDelivery.status).toBe(400);
      const noSecret = await receiveWebhook(anon(), {
        slug: 'github',
        rawBody,
        headers: { 'x-hub-signature-256': signGithub(GITHUB_SECRET, rawBody) },
        secrets: {},
      });
      expect(noSecret.status).toBe(503);
    });

    it('BREAK: a forged-signature flood is capped in the audit log but always refused', async () => {
      const responses = [];
      for (let i = 0; i < INVALID_SIGNATURE_AUDITS_PER_WINDOW + 5; i++) {
        responses.push(await github('ping', { i }, { secret: 'forged' }));
      }
      expect(responses.every((r) => r.status === 401)).toBe(true);
      const audits = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'webhook.signature_invalid'));
      expect(audits).toHaveLength(INVALID_SIGNATURE_AUDITS_PER_WINDOW);
      kit.clock.advance(INVALID_SIGNATURE_AUDIT_WINDOW_SECONDS * 1000 + 1);
      await github('ping', { later: true }, { secret: 'forged' });
      expect(
        await kit.db
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.action, 'webhook.signature_invalid')),
      ).toHaveLength(INVALID_SIGNATURE_AUDITS_PER_WINDOW + 1);
    });

    it('stores payloads containing NUL characters safely', async () => {
      const response = await generic(null, { body: '{"text":"a\\u0000b"}' });
      expect(response.status).toBe(202);
      const [row] = await kit.db.select().from(webhookDeliveries);
      expect(row!.payload).toEqual({ text: 'ab' });
    });
  });

  describe('GitHub processing', () => {
    it('merged PR on a linked repo → submitted contribution, idempotent across redelivery', async () => {
      const project = await linkedProject();
      await github('pull_request', mergedPr(12));
      // Same PR delivered again under a different GUID (e.g. a second hook): same externalRef.
      await github('pull_request', { ...mergedPr(12), sender: { login: 'someone' } });
      await kit.drain(handlers);
      const rows = await kit.db.select().from(contributions);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        memberId: dev.memberId,
        projectId: project.id,
        kind: 'code',
        source: 'github',
        status: 'submitted',
        externalRef: 'github:pr:javelin/engine#12',
        url: 'https://github.com/Javelin/Engine/pull/12',
      });
      expect(rows[0]!.title).toBe('PR #12 — Faster parser @everyone');
      expect(rows[0]!.occurredAt).toEqual(new Date('2026-02-28T10:00:00Z'));
      const statuses = (await kit.db.select().from(webhookDeliveries)).map((d) => d.statusReason);
      expect(statuses.sort()).toEqual(['contribution already recorded', 'contribution recorded']);
    });

    it('a staff-verified GitHub account yields verified contributions', async () => {
      await linkedProject();
      await setExternalAccountVerification(kit.as(admin), {
        memberId: dev.memberId!,
        verified: true,
        externalId: '4242',
      });
      await github('pull_request', mergedPr(3));
      await kit.drain(handlers);
      const [row] = await kit.db.select().from(contributions);
      expect(row).toMatchObject({ status: 'verified', verifiedByUserId: null });
      const verified = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'contribution.verified'));
      expect(verified[0]!.payload).toMatchObject({
        automatic: true,
        verifiedBy: 'github',
        visibility: 'public',
      });
    });

    it('BREAK: verification without a bound GitHub id never auto-verifies', async () => {
      await linkedProject();
      await setExternalAccountVerification(kit.as(admin), {
        memberId: dev.memberId!,
        verified: true,
      });
      await github('pull_request', mergedPr(8));
      await kit.drain(handlers);
      const [row] = await kit.db.select().from(contributions);
      expect(row).toMatchObject({ status: 'submitted', memberId: dev.memberId });
    });

    it('BREAK: a push to the default branch is activity, never a contribution', async () => {
      const project = await linkedProject();
      const push = {
        ref: 'refs/heads/main',
        commits: Array.from({ length: 50 }, (_, i) => ({ id: String(i) })),
        head_commit: { id: 'abc123', message: 'feat: ship it\n\nbody' },
        pusher: { name: 'octodev' },
        repository: { full_name: 'javelin/engine', default_branch: 'main' },
      };
      await github('push', push);
      await github('push', { ...push, ref: 'refs/heads/feature' });
      await kit.drain(handlers);
      expect(await kit.db.select().from(contributions)).toHaveLength(0);
      const [event] = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'project.github_push'));
      expect(event).toMatchObject({ aggregateId: project.id, subjectMemberId: null });
      expect(event!.payload).toMatchObject({ commitCount: 50, headline: 'feat: ship it' });
      const reasons = (await kit.db.select().from(webhookDeliveries)).map((d) => d.statusReason);
      expect(reasons).toContain('not the default branch');
    });

    it('records published releases as project activity', async () => {
      await linkedProject();
      await github('release', {
        action: 'published',
        release: {
          tag_name: 'v1.0.0',
          name: 'One',
          html_url: 'https://github.com/javelin/engine/releases/v1.0.0',
        },
        repository: { full_name: 'javelin/engine' },
      });
      await kit.drain(handlers);
      const [event] = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'project.release_published'));
      expect(event!.payload).toMatchObject({ tag: 'v1.0.0', visibility: 'public' });
    });

    it.each([
      [
        'unmerged PR',
        mergedPr(1, {
          action: 'closed',
          pull_request: { ...mergedPr(1).pull_request, merged: false },
        }),
        'pull request not merged',
      ],
      [
        'unlinked repo',
        mergedPr(2, { repository: { full_name: 'other/repo' } }),
        'repository not linked to a project',
      ],
      [
        'unknown author',
        mergedPr(3, {
          pull_request: { ...mergedPr(3).pull_request, user: { login: 'stranger', id: 1 } },
        }),
        'author has no linked JAVE account',
      ],
      [
        'bot author',
        mergedPr(4, {
          pull_request: {
            ...mergedPr(4).pull_request,
            user: { login: 'octodev', id: 4242, type: 'Bot' },
          },
        }),
        'bot author',
      ],
      ['garbage payload', { action: 'closed', number: 'x' }, 'unrecognized pull_request payload'],
    ])('ignores %s', async (_label, payload, reason) => {
      await linkedProject();
      await github('pull_request', payload);
      await kit.drain(handlers);
      const [delivery] = await kit.db.select().from(webhookDeliveries);
      expect(delivery).toMatchObject({ status: 'ignored', statusReason: reason });
      expect(await kit.db.select().from(contributions)).toHaveLength(0);
    });

    it('respects the githubAutoContributions setting', async () => {
      await linkedProject();
      await updateSettings(kit.system, 'integrations', { githubAutoContributions: false });
      await github('pull_request', mergedPr(5));
      await kit.drain(handlers);
      expect(await kit.db.select().from(contributions)).toHaveLength(0);
    });

    it('BREAK: a renamed-and-reclaimed login does not inherit a bound identity', async () => {
      await linkedProject();
      await setExternalAccountVerification(kit.as(admin), {
        memberId: dev.memberId!,
        verified: true,
        externalId: '4242',
      });
      // Same login, different GitHub user id (the name was re-registered by someone else).
      await github(
        'pull_request',
        mergedPr(6, {
          pull_request: { ...mergedPr(6).pull_request, user: { login: 'octodev', id: 9999 } },
        }),
      );
      await kit.drain(handlers);
      expect(await kit.db.select().from(contributions)).toHaveLength(0);
    });
  });

  describe('generic, relay and unconfigured providers', () => {
    it('stores generic deliveries and enqueues a sanitized Discord relay', async () => {
      await generic({ text: '@everyone deploy <@123456789012345678> finished' });
      await kit.drain(handlers);
      const [relay] = await kit.db
        .select()
        .from(jobs)
        .where(eq(jobs.type, DISCORD_INTEGRATIONS_RELAY_JOB));
      expect(relay!.payload).toMatchObject({
        channelId: '123456789012345678',
        title: 'CI · deploy',
        text: '@​everyone deploy <@​123456789012345678> finished',
      });
      const [delivery] = await kit.db.select().from(webhookDeliveries);
      await markRelayDelivered(kit.system, {
        deliveryId: delivery!.id,
        messageId: '223456789012345678',
      });
      await markRelayFailed(kit.system, { deliveryId: delivery!.id, reason: 'Missing Access' });
      const [after] = await kit.db.select().from(webhookDeliveries);
      expect(after).toMatchObject({
        relayMessageId: '223456789012345678',
        lastError: 'relay failed: Missing Access',
      });
      await expect(
        markRelayDelivered(kit.as(admin), {
          deliveryId: delivery!.id,
          messageId: '223456789012345678',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('sidus deliveries are stored and explicitly ignored — never fake-processed', async () => {
      const sidus = await createIntegration(kit.as(admin), {
        provider: 'sidus',
        name: 'Sidus',
        slug: 'sidus',
      });
      const rawBody = '{"paper":"x"}';
      const timestamp = String(Math.floor(kit.clock.now().getTime() / 1000));
      const response = await receiveWebhook(anon(), {
        slug: 'sidus',
        rawBody,
        headers: {
          'x-jave-timestamp': timestamp,
          'x-jave-signature': signJave(sidus.signingSecret!, timestamp, rawBody),
          'x-jave-delivery': 's-1',
        },
        secrets: {},
      });
      expect(response.status).toBe(202);
      await kit.drain(handlers);
      const [delivery] = await kit.db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.provider, 'sidus'));
      expect(delivery).toMatchObject({
        status: 'ignored',
        statusReason: 'no processor configured',
        eventType: 'generic',
      });
    });

    it('failing processors retry with backoff, then go dead with an audit; operators can retry', async () => {
      let calls = 0;
      const flaky = createIntegrationJobHandlers({
        processors: {
          ...DEFAULT_PROCESSORS,
          generic: async () => {
            calls++;
            throw new Error('downstream unavailable');
          },
        },
      });
      await generic({ text: 'x' });
      await kit.drain(flaky);
      let [delivery] = await kit.db.select().from(webhookDeliveries);
      expect(delivery).toMatchObject({
        status: 'failed',
        attempts: 1,
        lastError: 'downstream unavailable',
      });
      for (let i = 0; i < 10; i++) {
        kit.clock.advance(2 * 60 * 60 * 1000);
        await kit.drain(flaky);
      }
      [delivery] = await kit.db.select().from(webhookDeliveries);
      expect(delivery!.status).toBe('dead');
      expect(calls).toBe(6);
      const dead = await kit.db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.action, 'webhook.delivery_dead'), eq(auditLogs.targetId, delivery!.id)),
        );
      expect(dead).toHaveLength(1);

      await retryWebhookDelivery(kit.as(admin), { deliveryId: delivery!.id });
      await kit.drain(handlers);
      [delivery] = await kit.db.select().from(webhookDeliveries);
      expect(delivery).toMatchObject({ status: 'processed', statusReason: 'stored and relayed' });
    });
  });
});
