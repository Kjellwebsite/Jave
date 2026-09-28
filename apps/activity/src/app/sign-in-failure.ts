import { ApiError } from '../api/client';
import { AuthMismatchError } from '../platform/hosts';

export interface SignInProblem {
  title: string;
  description: string;
  reference: string | null;
  /**
   * Set when JAVELIN asked the Activity to come back later (HTTP 429): the
   * sign-in is retried on its own after this long. Null: the member decides.
   */
  retryAfterMs: number | null;
}

const HTTP_NOT_FOUND = 404;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;
const MS_PER_SECOND = 1000;
/** Used when a 429 carries no Retry-After. */
const DEFAULT_RETRY_AFTER_SECONDS = 10;
/** Bounds on the automatic wait, whatever the server asks for. */
export const MIN_AUTO_RETRY_MS = 1_000;
export const MAX_AUTO_RETRY_MS = 60_000;

/** The server's Retry-After, clamped to a sane automatic wait. */
export function autoRetryDelay(retryAfterSeconds: number | null): number {
  const asked = (retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS) * MS_PER_SECOND;
  return Math.min(MAX_AUTO_RETRY_MS, Math.max(MIN_AUTO_RETRY_MS, asked));
}

/** Calm, specific copy for the ways sign-in fails. Never echoes raw error text from Discord. */
export function describeSignInFailure(error: unknown, mode: 'discord' | 'dev'): SignInProblem {
  if (error instanceof AuthMismatchError) {
    return {
      title: 'SIGN-IN REFUSED',
      description: 'Discord and JAVELIN disagree about who is signed in. Relaunch the Activity.',
      reference: null,
      retryAfterMs: null,
    };
  }
  if (error instanceof ApiError) {
    if (mode === 'dev' && error.status === HTTP_NOT_FOUND) {
      return {
        title: 'DEV SIGN-IN DISABLED',
        description:
          'The dashboard refuses dev personas. Start it with JAVE_DEV_AUTH=true outside production.',
        reference: null,
        retryAfterMs: null,
      };
    }
    if (error.status === HTTP_FORBIDDEN) {
      return {
        title: 'ACCESS RESTRICTED',
        description: error.message,
        reference: null,
        retryAfterMs: null,
      };
    }
    // Throttled is not offline: the server answered and said when to come back.
    if (error.status === HTTP_TOO_MANY_REQUESTS) {
      return {
        title: 'JAVELIN IS BUSY',
        description: 'Too many sign-ins at once. The Activity tries again on its own.',
        reference: null,
        retryAfterMs: autoRetryDelay(error.retryAfterSeconds),
      };
    }
    if (error.transient) {
      return {
        title: 'CONNECTION LOST',
        description: 'JAVELIN could not be reached. Check the connection and try again.',
        reference: error.reference,
        retryAfterMs: null,
      };
    }
    return {
      title: 'SIGN-IN FAILED',
      description: error.message,
      reference: error.reference,
      retryAfterMs: null,
    };
  }
  return {
    title: 'SIGN-IN FAILED',
    description:
      mode === 'discord'
        ? 'Discord did not complete the sign-in. Relaunch the Activity to try again.'
        : 'The mock Discord client did not start.',
    reference: null,
    retryAfterMs: null,
  };
}
