import { lookup } from 'node:dns/promises';
import { eq, sql } from 'drizzle-orm';
import { domainEvents, outboundDeliveries, outboundWebhooks } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ExternalServiceError } from '../kernel/errors';
import { isUuid } from '../kernel/ids';
import { redact } from '../kernel/redact';
import { recordAudit } from '../audit/audit.service';
import type { DomainEventRecord } from '../events/bus';
import type { JobRecord } from '../jobs/queue';
import { type JobHandler, PermanentJobError } from '../jobs/worker';
import { notifyCapabilityHolders } from '../notifications/notifications.service';
import { getSettings } from '../settings/settings.service';
import {
  MAX_ERROR_LENGTH,
  OUTBOUND_MAX_CONSECUTIVE_FAILURES,
  OUTBOUND_TIMEOUT_MS,
  OUTBOUND_USER_AGENT,
} from './constants';
import type { OutboundDeliveryRecord, OutboundWebhookRecord } from './outbound.service';
import { openSecret } from './secrets';
import { signJave } from './signatures';
import { isBlockedAddress, isIpLiteral, validateOutboundUrl } from './ssrf';

/** The subset of `fetch` the delivery job uses (inject a fake in tests). */
export interface OutboundRequestInit {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  redirect: 'manual';
  signal: AbortSignal;
}

export interface OutboundResponse {
  status: number;
  body?: { cancel: () => Promise<void> } | null;
}

export type FetchLike = (url: string, init: OutboundRequestInit) => Promise<OutboundResponse>;
export type HostResolver = (hostname: string) => Promise<string[]>;

export interface OutboundDependencies {
  fetch: FetchLike;
  /** Resolve a hostname to IP addresses (SSRF re-check before connecting). */
  resolveHost: HostResolver;
  timeoutMs: number;
  maxConsecutiveFailures: number;
}

export const systemFetch: FetchLike = (url, init) => fetch(url, init);

export const systemResolveHost: HostResolver = async (hostname) => {
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => answer.address);
};

export const DEFAULT_OUTBOUND_DEPENDENCIES: OutboundDependencies = {
  fetch: systemFetch,
  resolveHost: systemResolveHost,
  timeoutMs: OUTBOUND_TIMEOUT_MS,
  maxConsecutiveFailures: OUTBOUND_MAX_CONSECUTIVE_FAILURES,
};

export const OUTBOUND_HEADERS = {
  event: 'X-Jave-Event',
  delivery: 'X-Jave-Delivery',
  timestamp: 'X-Jave-Timestamp',
  signature: 'X-Jave-Signature',
} as const;

const HTTP_SUCCESS_MIN = 200;
const HTTP_SUCCESS_MAX = 299;
/** Statuses worth retrying: timeouts, rate limits, server errors. Others are final. */
const RETRYABLE_STATUSES = new Set([408, 425, 429]);
const SERVER_ERROR_MIN = 500;
const MILLIS_PER_SECOND = 1000;

function retryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status) || status >= SERVER_ERROR_MIN;
}

/** The JSON body receivers get. `data` is the event payload with secret-looking values redacted. */
export function outboundEnvelope(event: DomainEventRecord) {
  return {
    id: String(event.id),
    type: event.type,
    occurredAt: event.occurredAt.toISOString(),
    aggregate: { type: event.aggregateType, id: event.aggregateId },
    subjectMemberId: event.subjectMemberId,
    data: redact(event.payload),
  };
}

function networkFailure(error: unknown, timeoutMs: number): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') return `timed out after ${timeoutMs} ms`;
  // Only the error code: messages can echo the target URL, which may embed credentials.
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof cause === 'string' ? `network error (${cause})` : 'network error';
}

interface Attempt {
  ctx: ServiceContext;
  deps: OutboundDependencies;
  job: JobRecord;
  delivery: OutboundDeliveryRecord;
  webhook: OutboundWebhookRecord;
}

interface Failure {
  message: string;
  permanent: boolean;
  responseStatus?: number | null;
  /** False for JAVE-side problems (e.g. missing encryption key): the endpoint is not to blame. */
  countsAgainstEndpoint?: boolean;
}

/**
 * Bump the subscription's failure streak; at the threshold disable it,
 * audit, and alert integration managers. Returns true when disabled now.
 */
async function recordEndpointFailure(
  ctx: ServiceContext,
  attempt: Attempt,
  message: string,
): Promise<boolean> {
  const { deps, webhook } = attempt;
  const now = ctx.clock.now();
  const [hook] = await ctx.db
    .update(outboundWebhooks)
    .set({
      consecutiveFailures: sql`${outboundWebhooks.consecutiveFailures} + 1`,
      lastFailureAt: now,
      lastError: message,
    })
    .where(eq(outboundWebhooks.id, webhook.id))
    .returning({
      failures: outboundWebhooks.consecutiveFailures,
      enabled: outboundWebhooks.enabled,
    });
  if (!hook?.enabled || hook.failures < deps.maxConsecutiveFailures) return false;
  const reason = `${hook.failures} consecutive delivery failures`;
  await ctx.db
    .update(outboundWebhooks)
    .set({ enabled: false, disabledAt: now, disabledReason: reason })
    .where(eq(outboundWebhooks.id, webhook.id));
  await recordAudit(ctx, {
    action: 'integration.outbound_auto_disabled',
    targetType: 'outbound_webhook',
    targetId: webhook.id,
    result: 'failure',
    context: { failures: hook.failures, lastError: message },
  });
  await notifyCapabilityHolders(ctx, 'canManageIntegrations', {
    type: 'integration.alert',
    title: 'WEBHOOK DISABLED',
    body: `${webhook.name} — disabled after ${hook.failures} consecutive failures. Fix the endpoint, then re-enable it.`,
    data: { webhookId: webhook.id },
    dedupeKey: `outbound:${webhook.id}:disabled:${now.getTime()}`,
  });
  return true;
}

/**
 * Record a failed attempt and throw for the queue: retry with backoff, or
 * dead-letter when permanent, out of attempts, or the subscription was just
 * disabled.
 */
async function fail(attempt: Attempt, failure: Failure): Promise<never> {
  const { ctx, job, delivery } = attempt;
  const message = failure.message.slice(0, MAX_ERROR_LENGTH);
  const dead = await withTransaction(ctx, async (t) => {
    const disabled =
      failure.countsAgainstEndpoint === false
        ? false
        : await recordEndpointFailure(t, attempt, message);
    const isDead = failure.permanent || disabled || job.attempts >= job.maxAttempts;
    await t.db
      .update(outboundDeliveries)
      .set({
        status: isDead ? 'dead' : 'failed',
        attempts: job.attempts,
        responseStatus: failure.responseStatus ?? null,
        lastError: message,
      })
      .where(eq(outboundDeliveries.id, delivery.id));
    return isDead;
  });
  throw dead ? new PermanentJobError(message) : new ExternalServiceError('webhook', message);
}

async function succeed(attempt: Attempt, status: number) {
  const { ctx, job, delivery, webhook } = attempt;
  await withTransaction(ctx, async (t) => {
    const now = t.clock.now();
    await t.db
      .update(outboundDeliveries)
      .set({
        status: 'processed',
        attempts: job.attempts,
        responseStatus: status,
        lastError: null,
        deliveredAt: now,
      })
      .where(eq(outboundDeliveries.id, delivery.id));
    await t.db
      .update(outboundWebhooks)
      .set({ consecutiveFailures: 0, lastDeliveryAt: now, lastError: null })
      .where(eq(outboundWebhooks.id, webhook.id));
  });
  return { status };
}

/** SSRF gate at send time: URL rules, then every resolved address. */
async function checkTarget(attempt: Attempt): Promise<URL> {
  const settings = await getSettings(attempt.ctx, 'integrations');
  const check = validateOutboundUrl(attempt.webhook.url, {
    allowInsecure: settings.allowInsecureForDev,
  });
  if (!check.ok)
    return fail(attempt, { message: `target rejected: ${check.reason}`, permanent: true });
  const host = check.url.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (isIpLiteral(host)) return check.url;
  let addresses: string[];
  try {
    addresses = await attempt.deps.resolveHost(host);
  } catch {
    return fail(attempt, { message: 'DNS lookup failed', permanent: false });
  }
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    return fail(attempt, {
      message: 'target resolves to a private or reserved address',
      permanent: true,
    });
  }
  return check.url;
}

/**
 * `integrations.deliver_outbound` — POST one event to one subscription,
 * signed with JAVE v1 (X-Jave-Signature: v1=HMAC(secret, "<ts>.<body>")).
 * Redirects are not followed (they could point inside the network).
 */
export function createDeliverOutboundHandler(deps: OutboundDependencies): JobHandler {
  return async (ctx, payload, job) => {
    const deliveryId = payload.deliveryId;
    if (typeof deliveryId !== 'string' || !isUuid(deliveryId)) {
      throw new PermanentJobError('deliveryId missing');
    }
    const [row] = await ctx.db
      .select({ delivery: outboundDeliveries, webhook: outboundWebhooks })
      .from(outboundDeliveries)
      .innerJoin(outboundWebhooks, eq(outboundWebhooks.id, outboundDeliveries.webhookId))
      .where(eq(outboundDeliveries.id, deliveryId));
    // Deleting a subscription cascades to its deliveries; queued jobs then have nothing to do.
    if (!row) return { skipped: 'subscription deleted' };
    const { delivery, webhook } = row;
    if (delivery.status === 'processed' || delivery.status === 'ignored') {
      return { skipped: delivery.status };
    }
    if (!webhook.enabled) {
      await ctx.db
        .update(outboundDeliveries)
        .set({ status: 'ignored', lastError: 'webhook disabled' })
        .where(eq(outboundDeliveries.id, delivery.id));
      return { skipped: 'webhook disabled' };
    }
    const [event] = await ctx.db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.id, delivery.eventId));
    if (!event) throw new PermanentJobError(`event ${delivery.eventId} not found`);

    const attempt: Attempt = { ctx, deps, job, delivery, webhook };
    const target = await checkTarget(attempt);
    let secret: string;
    try {
      secret = openSecret(ctx, webhook.secretCiphertext);
    } catch {
      // JAVE's fault (missing/rotated JAVE_ENCRYPTION_KEY), not the endpoint's.
      return fail(attempt, {
        message: 'signing secret unavailable (check JAVE_ENCRYPTION_KEY)',
        permanent: false,
        countsAgainstEndpoint: false,
      });
    }
    const body = JSON.stringify(outboundEnvelope(event));
    const timestamp = String(Math.floor(ctx.clock.now().getTime() / MILLIS_PER_SECOND));

    let status: number | null = null;
    let networkError: string | null = null;
    try {
      const response = await deps.fetch(target.href, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': OUTBOUND_USER_AGENT,
          [OUTBOUND_HEADERS.event]: event.type,
          [OUTBOUND_HEADERS.delivery]: delivery.id,
          [OUTBOUND_HEADERS.timestamp]: timestamp,
          [OUTBOUND_HEADERS.signature]: signJave(secret, timestamp, body),
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(deps.timeoutMs),
      });
      status = response.status;
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      networkError = networkFailure(error, deps.timeoutMs);
    }
    if (status !== null && status >= HTTP_SUCCESS_MIN && status <= HTTP_SUCCESS_MAX) {
      return succeed(attempt, status);
    }
    return fail(attempt, {
      message: networkError ?? `HTTP ${status}`,
      responseStatus: status,
      permanent: status !== null && !retryableStatus(status),
    });
  };
}
