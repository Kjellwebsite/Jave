/**
 * Error model. Every error JAVE raises on purpose is a JaveError with a stable
 * `code` and a user-safe `message`. Anything else is unexpected: callers log
 * it with an error ID and show the user only the ID.
 */
export type ErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'UNAUTHENTICATED'
  | 'CONFLICT'
  | 'INVALID_STATE'
  | 'RATE_LIMITED'
  | 'EXTERNAL_SERVICE'
  | 'DISABLED';

export class JaveError extends Error {
  readonly code: ErrorCode;
  /** Safe to show to the end user. */
  readonly userMessage: string;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, userMessage: string, details?: Record<string, unknown>) {
    super(userMessage);
    this.name = 'JaveError';
    this.code = code;
    this.userMessage = userMessage;
    this.details = details;
  }
}

export class ValidationError extends JaveError {
  readonly issues: { path: string; message: string }[];
  constructor(message: string, issues: { path: string; message: string }[] = []) {
    super('VALIDATION', message, { issues });
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

export class NotFoundError extends JaveError {
  constructor(entity: string, details?: Record<string, unknown>) {
    super('NOT_FOUND', `${entity} not found.`, details);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends JaveError {
  constructor(
    message = 'You do not have permission to do that.',
    details?: Record<string, unknown>,
  ) {
    super('FORBIDDEN', message, details);
    this.name = 'ForbiddenError';
  }
}

export class UnauthenticatedError extends JaveError {
  constructor(message = 'Sign in required.') {
    super('UNAUTHENTICATED', message);
    this.name = 'UnauthenticatedError';
  }
}

export class ConflictError extends JaveError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CONFLICT', message, details);
    this.name = 'ConflictError';
  }
}

/** The entity exists but is in a state that does not allow this transition. */
export class InvalidStateError extends JaveError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('INVALID_STATE', message, details);
    this.name = 'InvalidStateError';
  }
}

export class RateLimitedError extends JaveError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, message = 'Slow down — try again shortly.') {
    super('RATE_LIMITED', message, { retryAfterSeconds });
    this.name = 'RateLimitedError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ExternalServiceError extends JaveError {
  readonly service: string;
  readonly retryable: boolean;
  constructor(service: string, message: string, retryable = true) {
    super('EXTERNAL_SERVICE', message, { service });
    this.name = 'ExternalServiceError';
    this.service = service;
    this.retryable = retryable;
  }
}

export class DisabledError extends JaveError {
  constructor(feature: string) {
    super('DISABLED', `${feature} is currently disabled.`);
    this.name = 'DisabledError';
  }
}

export function isJaveError(error: unknown): error is JaveError {
  return error instanceof JaveError;
}

/** Postgres unique_violation. Works for both postgres-js and PGlite errors. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  return candidates.some((candidate) => {
    const e = candidate as { code?: string; constraint_name?: string; constraint?: string } | null;
    if (!e || e.code !== '23505') return false;
    if (!constraint) return true;
    return e.constraint_name === constraint || e.constraint === constraint;
  });
}
