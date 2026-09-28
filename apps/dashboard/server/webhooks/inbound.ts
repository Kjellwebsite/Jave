import 'server-only';
import {
  consumeRateLimit,
  integrations,
  newErrorId,
  RateLimitedError,
  type ServiceContext,
} from '@jave/core';

/**
 * Inbound webhook endpoint logic, framework-agnostic so it can be unit-tested
 * with plain `Request` objects. The route handlers under
 * `app/api/webhooks/` only assemble the dependencies.
 *
 * Contract (docs/modules/integrations.md): the RAW body goes to
 * `integrations.receiveWebhook` exactly as received — never parsed or
 * re-serialized before verification — with lowercase header names. No
 * session cookie is read; these endpoints are authenticated by signature
 * only and sit outside the dashboard's CSRF origin checks (senders are
 * servers, not browsers).
 */

/** Per sender address and integration slug. Generous for real senders, tight for floods. */
export const WEBHOOK_RATE_LIMIT = { limit: 120, windowSeconds: 60 } as const;
/**
 * Per sender address across every slug, consumed first: inventing new slugs
 * never escapes the flood limit, and never adds a rate-limit row per slug.
 */
export const WEBHOOK_SENDER_RATE_LIMIT = { limit: 600, windowSeconds: 60 } as const;

const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_INTERNAL_ERROR = 500;
/** Rate-limit key segment for slugs that do not name an enabled integration. */
const UNKNOWN_SLUG_KEY = '_unknown';
/** Slugs are attacker-chosen; log at most this much of one. */
const LOGGED_SLUG_MAX = 64;

export interface InboundWebhookDeps {
  /** Anonymous request context (receiveWebhook switches to the integration actor itself). */
  ctx: ServiceContext;
  /** Deployment secret for GitHub signatures (GITHUB_WEBHOOK_SECRET); undefined → 503. */
  githubSecret: string | undefined;
  /** Keyed hash of the sender's address — never the raw IP. */
  clientKey: string;
}

type BodyRead = { ok: true; text: string } | { ok: false };

function json(status: number, body: Record<string, unknown>, headers: HeadersInit = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

function tooLarge(): Response {
  return json(integrations.WEBHOOK_HTTP_STATUS.payloadTooLarge, { error: 'payload_too_large' });
}

/**
 * Read the body as UTF-8 text, refusing to buffer more than `maxBytes`:
 * a declared Content-Length above the cap is refused before reading, and a
 * stream that grows past it is cancelled mid-read. A leading byte-order mark
 * is kept, so the text is exactly what the sender signed.
 */
export async function readBodyCapped(request: Request, maxBytes: number): Promise<BodyRead> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false };
  if (!request.body) return { ok: true, text: '' };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) };
}

async function consumeWebhookBudgets(
  ctx: ServiceContext,
  slug: string,
  clientKey: string,
): Promise<void> {
  const sender = WEBHOOK_SENDER_RATE_LIMIT;
  await consumeRateLimit(ctx, `webhook:*:${clientKey}`, sender.limit, sender.windowSeconds);
  const slugKey = (await integrations.isKnownWebhookSlug(ctx, slug)) ? slug : UNKNOWN_SLUG_KEY;
  const perSlug = WEBHOOK_RATE_LIMIT;
  await consumeRateLimit(
    ctx,
    `webhook:${slugKey}:${clientKey}`,
    perSlug.limit,
    perSlug.windowSeconds,
  );
}

/** Lowercased header map (Headers already lowercases names; this also drops duplicates). */
function headerRecord(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/**
 * POST /api/webhooks/{slug}: rate limit → size cap → raw body →
 * integrations.receiveWebhook (signature, replay window, idempotency) →
 * the pipeline's status and JSON body. Unexpected failures answer 500 with
 * an error reference that matches the server log; nothing else leaks.
 */
export async function handleInboundWebhook(
  request: Request,
  slug: string,
  deps: InboundWebhookDeps,
): Promise<Response> {
  const { ctx } = deps;
  try {
    try {
      await consumeWebhookBudgets(ctx, slug, deps.clientKey);
    } catch (error) {
      if (!(error instanceof RateLimitedError)) throw error;
      return json(
        HTTP_TOO_MANY_REQUESTS,
        { error: 'rate_limited' },
        { 'Retry-After': String(error.retryAfterSeconds) },
      );
    }
    const body = await readBodyCapped(request, integrations.MAX_WEBHOOK_BODY_BYTES);
    if (!body.ok) return tooLarge();
    const result = await integrations.receiveWebhook(ctx, {
      slug,
      headers: headerRecord(request),
      rawBody: body.text,
      secrets: { github: deps.githubSecret },
    });
    return json(result.status, result.body);
  } catch (error) {
    const reference = newErrorId();
    ctx.logger.error(
      { err: error, reference, slug: slug.slice(0, LOGGED_SLUG_MAX) },
      'inbound webhook failed',
    );
    return json(HTTP_INTERNAL_ERROR, { error: 'internal_error', reference });
  }
}
