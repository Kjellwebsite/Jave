import { eq } from 'drizzle-orm';
import { integrations, webhookDeliveries } from '@jave/database';
import { type ServiceContext, withActor, withTransaction } from '../kernel/context';
import { hmacSha256Hex, sha256Hex } from '../kernel/crypto';
import { isJaveError, RateLimitedError } from '../kernel/errors';
import { recordAudit } from '../audit/audit.service';
import { enqueueJob } from '../jobs/queue';
import type { IntegrationActor } from '../permissions/actor';
import { consumeRateLimit } from '../rate-limit/rate-limit';
import { integrationSlugSchema, usesJaveSignature } from './config';
import {
  INVALID_SIGNATURE_AUDIT_WINDOW_SECONDS,
  INVALID_SIGNATURE_AUDITS_PER_WINDOW,
  MAX_DELIVERY_ID_LENGTH,
  MAX_ERROR_LENGTH,
  MAX_WEBHOOK_BODY_BYTES,
  PROCESS_DELIVERY_JOB,
  PROCESS_DELIVERY_MAX_ATTEMPTS,
  REPLAY_WINDOW_MS,
} from './constants';
import { cleanLine, parseJsonObject } from './payload';
import type { IntegrationRecord } from './registry.service';
import { openSecret } from './secrets';
import { javeSigningPayload, verifyGithubSignature, verifyJaveSignature } from './signatures';

/**
 * Framework-agnostic inbound webhook pipeline. The dashboard route handler
 * reads the raw body (capped at MAX_WEBHOOK_BODY_BYTES while streaming),
 * lowercases header names and passes the deployment's GitHub secret:
 *
 *   const { status, body } = await integrations.receiveWebhook(ctx, {
 *     slug, headers, rawBody, secrets: { github: env.GITHUB_WEBHOOK_SECRET },
 *   });
 *   return Response.json(body, { status });
 *
 * Order: size → integration → signature (+ replay window) → JSON → persist
 * (idempotent) → enqueue processing. Nothing is processed inline.
 */
export interface InboundWebhookRequest {
  slug: string;
  headers: Readonly<Record<string, string | undefined>>;
  rawBody: string;
  secrets: { github?: string };
}

export interface InboundWebhookResponse {
  status: number;
  body: Record<string, unknown>;
}

export const WEBHOOK_HTTP_STATUS = {
  ok: 200,
  accepted: 202,
  badRequest: 400,
  unauthorized: 401,
  notFound: 404,
  payloadTooLarge: 413,
  unavailable: 503,
} as const;

const DELIVERY_ID_PATTERN = new RegExp(`^[A-Za-z0-9._:-]{1,${MAX_DELIVERY_ID_LENGTH}}$`);
const EVENT_TYPE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const DEFAULT_JAVE_EVENT = 'generic';

const GITHUB_HEADERS = {
  signature: 'x-hub-signature-256',
  delivery: 'x-github-delivery',
  event: 'x-github-event',
} as const;

const JAVE_HEADERS = {
  timestamp: 'x-jave-timestamp',
  signature: 'x-jave-signature',
  delivery: 'x-jave-delivery',
  event: 'x-jave-event',
} as const;

function respond(status: number, body: Record<string, unknown>): InboundWebhookResponse {
  return { status, body };
}

const NOT_FOUND = respond(WEBHOOK_HTTP_STATUS.notFound, { error: 'not_found' });

type Verification =
  | { ok: true; deliveryId: string; eventType: string; signatureDigest: string }
  | { ok: false; response: InboundWebhookResponse };

function lowercaseHeaders(
  headers: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') out[key.toLowerCase()] = value.trim();
  }
  return out;
}

/**
 * Invalid-signature audits are capped per integration so a flood of forged
 * requests cannot flood the audit log; every request still gets a 401.
 */
async function auditBudgetAvailable(
  ctx: ServiceContext,
  integration: IntegrationRecord,
): Promise<boolean> {
  try {
    await consumeRateLimit(
      ctx,
      `webhook-invalid-signature:${integration.id}`,
      INVALID_SIGNATURE_AUDITS_PER_WINDOW,
      INVALID_SIGNATURE_AUDIT_WINDOW_SECONDS,
    );
    return true;
  } catch (error) {
    if (error instanceof RateLimitedError) return false;
    throw error;
  }
}

async function rejectSignature(
  ctx: ServiceContext,
  integration: IntegrationRecord,
  reason: string,
  deliveryId: string | undefined,
): Promise<Verification> {
  const rejected: Verification = {
    ok: false,
    response: respond(WEBHOOK_HTTP_STATUS.unauthorized, { error: 'invalid_signature' }),
  };
  if (!(await auditBudgetAvailable(ctx, integration))) return rejected;
  await recordAudit(
    ctx,
    {
      action: 'webhook.signature_invalid',
      targetType: 'integration',
      targetId: integration.id,
      result: 'denied',
      context: {
        provider: integration.provider,
        slug: integration.slug,
        reason,
        deliveryId: deliveryId ? cleanLine(deliveryId, MAX_DELIVERY_ID_LENGTH) : null,
      },
    },
    { durable: true },
  );
  await ctx.rootDb
    .update(integrations)
    .set({
      lastErrorAt: ctx.clock.now(),
      lastError: `signature rejected: ${reason}`.slice(0, MAX_ERROR_LENGTH),
    })
    .where(eq(integrations.id, integration.id));
  return rejected;
}

function identifiers(
  deliveryId: string | undefined,
  eventType: string | undefined,
): { deliveryId: string; eventType: string } | null {
  if (!deliveryId || !DELIVERY_ID_PATTERN.test(deliveryId)) return null;
  if (!eventType || !EVENT_TYPE_PATTERN.test(eventType)) return null;
  return { deliveryId, eventType: eventType.toLowerCase() };
}

const MISSING_IDENTIFIERS: Verification = {
  ok: false,
  response: respond(WEBHOOK_HTTP_STATUS.badRequest, { error: 'missing_delivery_headers' }),
};

async function verifyGithub(
  ctx: ServiceContext,
  integration: IntegrationRecord,
  headers: Record<string, string>,
  request: InboundWebhookRequest,
): Promise<Verification> {
  const secret = request.secrets.github;
  if (!secret) {
    ctx.logger.warn({ integrationId: integration.id }, 'GITHUB_WEBHOOK_SECRET is not configured');
    return {
      ok: false,
      response: respond(WEBHOOK_HTTP_STATUS.unavailable, { error: 'not_configured' }),
    };
  }
  const deliveryHeader = headers[GITHUB_HEADERS.delivery];
  if (!verifyGithubSignature(secret, request.rawBody, headers[GITHUB_HEADERS.signature])) {
    return rejectSignature(ctx, integration, 'signature_mismatch', deliveryHeader);
  }
  const ids = identifiers(deliveryHeader, headers[GITHUB_HEADERS.event]);
  if (!ids) return MISSING_IDENTIFIERS;
  const signatureDigest = sha256Hex(`github:${hmacSha256Hex(secret, request.rawBody)}`);
  return { ok: true, ...ids, signatureDigest };
}

async function verifyJave(
  ctx: ServiceContext,
  integration: IntegrationRecord,
  headers: Record<string, string>,
  request: InboundWebhookRequest,
): Promise<Verification> {
  let secret: string;
  try {
    if (!integration.secretCiphertext) throw new Error('integration has no signing secret');
    secret = openSecret(ctx, integration.secretCiphertext);
  } catch (error) {
    ctx.logger.error(
      { integrationId: integration.id, code: isJaveError(error) ? error.code : 'decrypt_failed' },
      'cannot load integration signing secret',
    );
    return {
      ok: false,
      response: respond(WEBHOOK_HTTP_STATUS.unavailable, { error: 'not_configured' }),
    };
  }
  const timestamp = headers[JAVE_HEADERS.timestamp];
  const deliveryHeader = headers[JAVE_HEADERS.delivery];
  const result = verifyJaveSignature({
    secret,
    timestamp,
    signature: headers[JAVE_HEADERS.signature],
    body: request.rawBody,
    now: ctx.clock.now(),
    windowMs: REPLAY_WINDOW_MS,
  });
  if (!result.ok) return rejectSignature(ctx, integration, result.reason, deliveryHeader);
  const ids = identifiers(deliveryHeader, headers[JAVE_HEADERS.event] ?? DEFAULT_JAVE_EVENT);
  if (!ids) return MISSING_IDENTIFIERS;
  const expected = hmacSha256Hex(secret, javeSigningPayload(timestamp!, request.rawBody));
  const signatureDigest = sha256Hex(`jave:v1:${timestamp}:${expected}`);
  return { ok: true, ...ids, signatureDigest };
}

export function integrationActor(integration: IntegrationRecord): IntegrationActor {
  return {
    kind: 'integration',
    integrationId: integration.id,
    provider: integration.provider,
    capabilities: new Set(),
  };
}

export async function receiveWebhook(
  ctx: ServiceContext,
  request: InboundWebhookRequest,
): Promise<InboundWebhookResponse> {
  if (Buffer.byteLength(request.rawBody, 'utf8') > MAX_WEBHOOK_BODY_BYTES) {
    return respond(WEBHOOK_HTTP_STATUS.payloadTooLarge, { error: 'payload_too_large' });
  }
  const slug = integrationSlugSchema.safeParse(request.slug);
  if (!slug.success) return NOT_FOUND;
  const [integration] = await ctx.db
    .select()
    .from(integrations)
    .where(eq(integrations.slug, slug.data));
  // Disabled integrations look exactly like unknown ones (no enumeration).
  if (!integration || !integration.enabled) return NOT_FOUND;

  const headers = lowercaseHeaders(request.headers);
  const verified = usesJaveSignature(integration.provider)
    ? await verifyJave(ctx, integration, headers, request)
    : await verifyGithub(ctx, integration, headers, request);
  if (!verified.ok) return verified.response;

  const parsed = parseJsonObject(request.rawBody);
  if (!parsed.ok) return respond(WEBHOOK_HTTP_STATUS.badRequest, { error: parsed.reason });

  return withTransaction(withActor(ctx, integrationActor(integration)), async (t) => {
    const now = t.clock.now();
    const [row] = await t.db
      .insert(webhookDeliveries)
      .values({
        integrationId: integration.id,
        provider: integration.provider,
        deliveryId: verified.deliveryId,
        eventType: verified.eventType,
        signatureDigest: verified.signatureDigest,
        payload: parsed.value,
        receivedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: webhookDeliveries.id });
    if (!row) return respond(WEBHOOK_HTTP_STATUS.ok, { ok: true, duplicate: true });
    await enqueueJob(
      t,
      PROCESS_DELIVERY_JOB,
      { deliveryId: row.id },
      { dedupeKey: `webhook:${row.id}`, maxAttempts: PROCESS_DELIVERY_MAX_ATTEMPTS },
    );
    await t.db
      .update(integrations)
      .set({ lastEventAt: now })
      .where(eq(integrations.id, integration.id));
    return respond(WEBHOOK_HTTP_STATUS.accepted, { ok: true, deliveryId: row.id });
  });
}
