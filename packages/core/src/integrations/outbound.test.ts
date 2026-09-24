import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  auditLogs,
  domainEvents,
  jobs,
  notifications,
  outboundDeliveries,
  outboundWebhooks,
} from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { HOUR } from '../kernel/clock';
import { DisabledError, ForbiddenError, ValidationError } from '../kernel/errors';
import type { UserActor } from '../permissions/actor';
import { createEventHandlers } from '../events/bus';
import type { JobHandlerMap } from '../jobs/worker';
import { updateSettings } from '../settings/settings.service';
import { createProject } from '../projects';
import {
  DELIVER_OUTBOUND_JOB,
  OUTBOUND_MAX_CONSECUTIVE_FAILURES,
  OUTBOUND_TIMEOUT_MS,
  REPLAY_WINDOW_MS,
} from './constants';
import { createIntegrationJobHandlers } from './handlers';
import { OUTBOUND_HEADERS } from './outbound.delivery';
import {
  createOutboundWebhook,
  deleteOutboundWebhook,
  listOutboundDeliveries,
  listOutboundWebhooks,
  updateOutboundWebhook,
} from './outbound.service';
import { outboundWebhookSubscriber } from './outbound.subscriber';
import { verifyJaveSignature } from './signatures';
import { type FakeReply, fakeFetch, testEncryptionKey, timeoutError } from './testing/fakes';
import {
  DB_HOOK_TIMEOUT_MS,
  DB_TEST_TIMEOUT_MS,
  WARM_UP_TIMEOUT_MS,
  warmTestDatabase,
} from '../projects/testing/warm-up';

const TARGET = 'https://hooks.example.test/jave/SECRET-PATH-TOKEN';
const PUBLIC_ADDRESS = '93.184.216.34';

beforeAll(warmTestDatabase, WARM_UP_TIMEOUT_MS);

describe('outbound webhooks', { timeout: DB_TEST_TIMEOUT_MS }, () => {
  let kit: TestKit;
  let admin: UserActor;
  let builder: UserActor;

  beforeEach(async () => {
    kit = await createTestKit({ encryptionKey: testEncryptionKey() });
    admin = await kit.member({ roles: ['core'], username: 'admin' });
    builder = await kit.member({ username: 'builder' });
  }, DB_HOOK_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  });

  function harness(replies: FakeReply[], addresses: string[] = [PUBLIC_ADDRESS]) {
    const fake = fakeFetch(replies);
    let lookups = 0;
    const handlers: JobHandlerMap = {
      ...createIntegrationJobHandlers({
        fetch: fake.fetch,
        resolveHost: async () => {
          lookups++;
          return addresses;
        },
      }),
      ...createEventHandlers([outboundWebhookSubscriber]),
    };
    return { ...fake, handlers, lookups: () => lookups };
  }

  async function subscribe(eventTypes = ['project.created']) {
    return createOutboundWebhook(kit.as(admin), { name: 'Analytics', url: TARGET, eventTypes });
  }

  const publicProject = (title = 'Open Engine') =>
    createProject(kit.as(builder), { title, visibility: 'public' });

  async function deliveries() {
    return kit.db.select().from(outboundDeliveries);
  }

  describe('subscriptions', () => {
    it('stores the secret encrypted, returns it once and masks the URL', async () => {
      const { webhook, signingSecret } = await subscribe();
      expect(signingSecret).toMatch(/^whsec_/);
      expect(webhook.displayUrl).toBe('https://hooks.example.test/…');
      expect(JSON.stringify(await listOutboundWebhooks(kit.as(admin)))).not.toContain(
        'SECRET-PATH-TOKEN',
      );
      const audit = await kit.db.select().from(auditLogs);
      expect(JSON.stringify(audit)).not.toContain('SECRET-PATH-TOKEN');
      expect(JSON.stringify(audit)).not.toContain(signingSecret);
    });

    it.each([
      'https://localhost/hook',
      'https://127.0.0.1/hook',
      'https://[::1]/hook',
      'https://169.254.169.254/latest',
      'https://2130706433/',
      'http://hooks.example.test/',
      'https://user:pw@hooks.example.test/',
    ])('BREAK: refuses unsafe target %s', async (url) => {
      await expect(
        createOutboundWebhook(kit.as(admin), { name: 'Bad', url, eventTypes: ['project.created'] }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('allows http only with the development flag', async () => {
      await updateSettings(kit.system, 'integrations', { allowInsecureForDev: true });
      const { webhook } = await createOutboundWebhook(kit.as(admin), {
        name: 'Dev sink',
        url: 'http://sink.example.test/hook',
        eventTypes: ['project.created'],
      });
      expect(webhook.displayUrl).toBe('http://sink.example.test/…');
    });

    it('BREAK: only external events can be subscribed', async () => {
      await expect(subscribe(['member.profile_updated'])).rejects.toBeInstanceOf(ValidationError);
      await expect(subscribe(['nonsense.event'])).rejects.toBeInstanceOf(ValidationError);
      await expect(subscribe([])).rejects.toBeInstanceOf(ValidationError);
    });

    it('BREAK: requires canManageIntegrations and the encryption key', async () => {
      const ops = await kit.member({ roles: ['operations'] });
      await expect(
        createOutboundWebhook(kit.as(ops), {
          name: 'X',
          url: TARGET,
          eventTypes: ['project.created'],
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const keyless = await createTestKit();
      try {
        const founder = await keyless.member({ roles: ['founder'] });
        await expect(
          createOutboundWebhook(keyless.as(founder), {
            name: 'Xy',
            url: TARGET,
            eventTypes: ['project.created'],
          }),
        ).rejects.toBeInstanceOf(DisabledError);
      } finally {
        await keyless.close();
      }
    });
  });

  describe('delivery', () => {
    it('signs with JAVE v1 and delivers the event envelope', async () => {
      const { signingSecret, webhook } = await subscribe();
      const h = harness([204]);
      const project = await publicProject();
      await kit.drain(h.handlers);

      expect(h.requests).toHaveLength(1);
      const [request] = h.requests;
      expect(request!.url).toBe(TARGET);
      expect(request!.init.redirect).toBe('manual');
      expect(request!.init.signal).toBeInstanceOf(AbortSignal);
      const headers = request!.init.headers;
      expect(headers[OUTBOUND_HEADERS.event]).toBe('project.created');
      const verification = verifyJaveSignature({
        secret: signingSecret,
        timestamp: headers[OUTBOUND_HEADERS.timestamp],
        signature: headers[OUTBOUND_HEADERS.signature],
        body: request!.init.body,
        now: kit.clock.now(),
        windowMs: REPLAY_WINDOW_MS,
      });
      expect(verification).toEqual({ ok: true });
      const body = JSON.parse(request!.init.body) as Record<string, unknown>;
      expect(body).toMatchObject({
        type: 'project.created',
        aggregate: { type: 'project', id: project.id },
        data: { projectId: project.id, visibility: 'public' },
      });

      const [delivery] = await deliveries();
      expect(headers[OUTBOUND_HEADERS.delivery]).toBe(delivery!.id);
      expect(delivery).toMatchObject({ status: 'processed', responseStatus: 204, attempts: 1 });
      const page = await listOutboundDeliveries(kit.as(admin), { webhookId: webhook.id });
      expect(page.total).toBe(1);
    });

    it('BREAK: members-only/private project events and internal events never leave JAVE', async () => {
      await subscribe(['project.created', 'project.status_changed']);
      const h = harness([200]);
      await createProject(kit.as(builder), { title: 'Members Only' });
      await createProject(kit.as(builder), { title: 'Secret', visibility: 'private' });
      await kit.drain(h.handlers);
      expect(h.requests).toHaveLength(0);
      expect(await deliveries()).toHaveLength(0);
    });

    it('delivers only subscribed event types, once per event even if dispatched twice', async () => {
      await subscribe(['project.shipped']);
      const h = harness([200]);
      await publicProject();
      await kit.drain(h.handlers);
      expect(h.requests).toHaveLength(0);

      await kit.db.update(outboundWebhooks).set({ eventTypes: ['project.created'] });
      const [event] = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'project.created'));
      await outboundWebhookSubscriber.handle(kit.system, event!);
      await outboundWebhookSubscriber.handle(kit.system, event!);
      await kit.drain(h.handlers);
      expect(await deliveries()).toHaveLength(1);
      expect(h.requests).toHaveLength(1);
    });

    it('retries transient failures with backoff and resets the failure streak on success', async () => {
      const { webhook } = await subscribe();
      const h = harness([500, timeoutError(), 200]);
      await publicProject();
      await kit.drain(h.handlers);
      let [delivery] = await deliveries();
      expect(delivery).toMatchObject({ status: 'failed', attempts: 1, responseStatus: 500 });

      await kit.drain(h.handlers);
      expect(h.requests).toHaveLength(1); // backoff: not due yet
      kit.clock.advance(HOUR);
      await kit.drain(h.handlers);
      [delivery] = await deliveries();
      expect(delivery).toMatchObject({
        status: 'failed',
        attempts: 2,
        lastError: `timed out after ${OUTBOUND_TIMEOUT_MS} ms`,
      });
      let [hook] = await kit.db
        .select()
        .from(outboundWebhooks)
        .where(eq(outboundWebhooks.id, webhook.id));
      expect(hook!.consecutiveFailures).toBe(2);

      kit.clock.advance(HOUR);
      await kit.drain(h.handlers);
      [delivery] = await deliveries();
      expect(delivery).toMatchObject({ status: 'processed', attempts: 3, responseStatus: 200 });
      [hook] = await kit.db
        .select()
        .from(outboundWebhooks)
        .where(eq(outboundWebhooks.id, webhook.id));
      expect(hook!.consecutiveFailures).toBe(0);
    });

    it.each([
      [410, 'HTTP 410'],
      [302, 'HTTP 302'],
    ])(
      'BREAK: a %s response is final (no retry, redirects never followed)',
      async (status, error) => {
        await subscribe();
        const h = harness([status]);
        await publicProject();
        await kit.drain(h.handlers);
        kit.clock.advance(HOUR);
        await kit.drain(h.handlers);
        expect(h.requests).toHaveLength(1);
        const [delivery] = await deliveries();
        expect(delivery).toMatchObject({ status: 'dead', lastError: error });
      },
    );

    it('BREAK: refuses to connect when DNS resolves to a private address (rebinding-style)', async () => {
      await subscribe();
      const h = harness([200], ['10.0.0.5']);
      await publicProject();
      await kit.drain(h.handlers);
      expect(h.lookups()).toBe(1);
      expect(h.requests).toHaveLength(0);
      const [delivery] = await deliveries();
      expect(delivery).toMatchObject({
        status: 'dead',
        lastError: 'target resolves to a private or reserved address',
      });
    });

    it(`disables a subscription after ${OUTBOUND_MAX_CONSECUTIVE_FAILURES} consecutive failures, audited and alerted`, async () => {
      const { webhook } = await subscribe(['project.created']);
      const h = harness([503]);
      await publicProject('First');
      await publicProject('Second');
      for (let round = 0; round < 12; round++) {
        await kit.drain(h.handlers);
        kit.clock.advance(2 * HOUR);
      }
      const [hook] = await kit.db
        .select()
        .from(outboundWebhooks)
        .where(eq(outboundWebhooks.id, webhook.id));
      expect(hook).toMatchObject({
        enabled: false,
        consecutiveFailures: OUTBOUND_MAX_CONSECUTIVE_FAILURES,
        disabledReason: `${OUTBOUND_MAX_CONSECUTIVE_FAILURES} consecutive delivery failures`,
      });
      expect(h.requests).toHaveLength(OUTBOUND_MAX_CONSECUTIVE_FAILURES);
      // The delivery that tripped the breaker is dead; the other one, still
      // waiting to retry, is dropped as ignored once it sees the disabled hook.
      expect((await deliveries()).map((d) => d.status).sort()).toEqual(['dead', 'ignored']);
      const [audit] = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'integration.outbound_auto_disabled'));
      expect(audit).toMatchObject({ targetId: webhook.id, result: 'failure' });
      const alerts = await kit.db
        .select()
        .from(notifications)
        .where(eq(notifications.type, 'integration.alert'));
      expect(alerts.map((n) => n.recipientUserId)).toEqual([admin.userId]);

      // Disabled subscriptions receive nothing new.
      await publicProject('Third');
      await kit.drain(h.handlers);
      expect(await deliveries()).toHaveLength(2);

      // Re-enabling clears the streak.
      const reenabled = await updateOutboundWebhook(kit.as(admin), {
        webhookId: webhook.id,
        enabled: true,
      });
      expect(reenabled).toMatchObject({ enabled: true, consecutiveFailures: 0, disabledAt: null });
    });

    it('a JAVE-side secret problem fails the delivery without blaming the endpoint', async () => {
      const { webhook } = await subscribe();
      await kit.db
        .update(outboundWebhooks)
        .set({ secretCiphertext: 'v1:corrupted:secret:blob' })
        .where(eq(outboundWebhooks.id, webhook.id));
      const h = harness([200]);
      await publicProject();
      await kit.drain(h.handlers);
      expect(h.requests).toHaveLength(0);
      const [delivery] = await deliveries();
      expect(delivery).toMatchObject({
        status: 'failed',
        lastError: 'signing secret unavailable (check JAVE_ENCRYPTION_KEY)',
      });
      const [hook] = await kit.db
        .select()
        .from(outboundWebhooks)
        .where(eq(outboundWebhooks.id, webhook.id));
      expect(hook!.consecutiveFailures).toBe(0);
    });

    it('deleting a subscription lets its queued deliveries finish quietly', async () => {
      const { webhook } = await subscribe();
      const h = harness([200]);
      await publicProject();
      // Fan the event out without running the delivery job yet.
      await kit.drain(createEventHandlers([outboundWebhookSubscriber]));
      expect(await deliveries()).toHaveLength(1);
      await deleteOutboundWebhook(kit.as(admin), { webhookId: webhook.id });
      expect(await deliveries()).toHaveLength(0);
      const outcomes = await kit.drain(h.handlers);
      expect(outcomes.find((o) => o.type === DELIVER_OUTBOUND_JOB)).toMatchObject({
        status: 'completed',
        result: { skipped: 'subscription deleted' },
      });
      expect(h.requests).toHaveLength(0);
      const dead = await kit.db.select().from(jobs).where(eq(jobs.status, 'dead'));
      expect(dead).toHaveLength(0);
    });

    it('BREAK: a subscription edited to an internal URL is refused at send time too', async () => {
      const { webhook } = await subscribe();
      await kit.db
        .update(outboundWebhooks)
        .set({ url: 'https://169.254.169.254/latest/meta-data/' })
        .where(eq(outboundWebhooks.id, webhook.id));
      const h = harness([200]);
      await publicProject();
      await kit.drain(h.handlers);
      expect(h.requests).toHaveLength(0);
      const [delivery] = await deliveries();
      expect(delivery!.lastError).toBe('target rejected: private or reserved IPv4 address');
    });
  });
});
