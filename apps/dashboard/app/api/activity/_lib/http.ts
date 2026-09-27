import 'server-only';
import type { z } from 'zod';
import {
  ConflictError,
  DisabledError,
  ExternalServiceError,
  ForbiddenError,
  InvalidStateError,
  isJaveError,
  type JaveError,
  newErrorId,
  NotFoundError,
  RateLimitedError,
  type ServiceContext,
  UnauthenticatedError,
  ValidationError,
} from '@jave/core';
import type { ActivityErrorBody } from './contract';

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_UNSUPPORTED_MEDIA_TYPE = 415;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_INTERNAL = 500;
const HTTP_BAD_GATEWAY = 502;
const HTTP_UNAVAILABLE = 503;

/** Every Activity response is personal and live: never cached anywhere. */
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** Request problems detected by the surface itself (before any service runs). */
export class ActivityHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ActivityHttpError';
  }
}

export const unauthenticated = () =>
  new ActivityHttpError(HTTP_UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in again to continue.');

export const notAvailable = () => new ActivityHttpError(HTTP_NOT_FOUND, 'NOT_FOUND', 'Not found.');

export function json<T>(body: T, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function errorBody(
  code: string,
  message: string,
  extra: Omit<ActivityErrorBody['error'], 'code' | 'message'> = {},
): ActivityErrorBody {
  return { error: { code, message, ...extra } };
}

function statusFor(error: JaveError): number {
  if (error instanceof ValidationError) return HTTP_BAD_REQUEST;
  if (error instanceof UnauthenticatedError) return HTTP_UNAUTHORIZED;
  if (error instanceof ForbiddenError) return HTTP_FORBIDDEN;
  if (error instanceof NotFoundError) return HTTP_NOT_FOUND;
  if (error instanceof ConflictError || error instanceof InvalidStateError) return HTTP_CONFLICT;
  if (error instanceof RateLimitedError) return HTTP_TOO_MANY_REQUESTS;
  if (error instanceof ExternalServiceError) return HTTP_BAD_GATEWAY;
  if (error instanceof DisabledError) return HTTP_UNAVAILABLE;
  return HTTP_BAD_REQUEST;
}

/**
 * Converts anything thrown into a JSON error. Domain errors carry a user-safe
 * message; anything else is logged with its stack under a fresh reference and
 * the client receives only that reference.
 */
export function errorResponse(error: unknown, ctx: ServiceContext, route: string): Response {
  if (error instanceof ActivityHttpError) {
    return json(errorBody(error.code, error.message), error.status);
  }
  if (isJaveError(error)) {
    if (error instanceof RateLimitedError) {
      return Response.json(
        errorBody(error.code, error.userMessage, { retryAfterSeconds: error.retryAfterSeconds }),
        {
          status: HTTP_TOO_MANY_REQUESTS,
          headers: { ...NO_STORE, 'Retry-After': String(error.retryAfterSeconds) },
        },
      );
    }
    return json(errorBody(error.code, error.userMessage), statusFor(error));
  }
  const reference = newErrorId();
  ctx.logger.error({ err: error, reference, route }, 'activity api request failed');
  return json(
    errorBody('INTERNAL', 'Something went wrong on our side.', { reference }),
    HTTP_INTERNAL,
  );
}

const JSON_CONTENT_TYPE = /^application\/json(\s*;.*)?$/i;

function notJson(): ActivityHttpError {
  return new ActivityHttpError(HTTP_BAD_REQUEST, 'VALIDATION', 'The request body is not JSON.');
}

/**
 * The body as UTF-8 text, reading at most `maxBytes`. The declared length is
 * checked first, and the stream is cut off as soon as it exceeds the cap, so
 * a chunked body without Content-Length can never be buffered whole.
 */
async function readBodyText(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw notJson();
  }
}

/**
 * Reads and validates a JSON body: JSON content type only, at most `maxBytes`
 * (declared length and bytes actually received), valid UTF-8, then the zod
 * schema. Schemas are strict, so unknown fields are refused.
 */
export async function readJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
  maxBytes: number,
): Promise<z.output<S>> {
  if (!JSON_CONTENT_TYPE.test(request.headers.get('content-type') ?? '')) {
    throw new ActivityHttpError(
      HTTP_UNSUPPORTED_MEDIA_TYPE,
      'UNSUPPORTED_MEDIA_TYPE',
      'Send JSON.',
    );
  }
  const text = await readBodyText(request, maxBytes);
  let value: unknown;
  try {
    value = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw notJson();
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(
      'The request is invalid.',
      parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

function tooLarge(): ActivityHttpError {
  return new ActivityHttpError(HTTP_PAYLOAD_TOO_LARGE, 'PAYLOAD_TOO_LARGE', 'Request too large.');
}

const BEARER = /^Bearer\s+(\S+)$/i;
const MAX_AUTHORIZATION_HEADER_LENGTH = 2048;

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header || header.length > MAX_AUTHORIZATION_HEADER_LENGTH) return null;
  return BEARER.exec(header)?.[1] ?? null;
}
