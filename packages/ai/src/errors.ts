/**
 * AI error model. Messages are operator-safe: they name the provider and the
 * failure class, never the API key, the prompt, or upstream response bodies.
 */
export type AIErrorKind =
  | 'rate_limited'
  | 'overloaded'
  | 'timeout'
  | 'auth'
  | 'invalid_request'
  | 'refusal'
  | 'disabled'
  | 'unavailable'
  | 'malformed_response'
  | 'aborted'
  | 'configuration';

export interface AIErrorOptions {
  provider: string;
  status?: number;
  retryAfterMs?: number;
  /** Upstream error type code (e.g. `overloaded_error`), never its message. */
  upstreamType?: string;
}

export class AIError extends Error {
  readonly kind: AIErrorKind;
  /** True when the same request may succeed later. */
  readonly retryable: boolean;
  readonly provider: string;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly upstreamType?: string;

  constructor(kind: AIErrorKind, retryable: boolean, message: string, options: AIErrorOptions) {
    super(message);
    this.name = 'AIError';
    this.kind = kind;
    this.retryable = retryable;
    this.provider = options.provider;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.upstreamType = options.upstreamType;
  }
}

function describe(options: AIErrorOptions, what: string): string {
  return `${options.provider}: ${what}${options.status ? ` (HTTP ${options.status})` : ''}`;
}

export class AIRateLimitError extends AIError {
  constructor(options: AIErrorOptions) {
    super('rate_limited', true, describe(options, 'rate limited'), options);
    this.name = 'AIRateLimitError';
  }
}

export class AIOverloadedError extends AIError {
  constructor(options: AIErrorOptions) {
    super('overloaded', true, describe(options, 'overloaded'), options);
    this.name = 'AIOverloadedError';
  }
}

export class AITimeoutError extends AIError {
  constructor(options: AIErrorOptions & { timeoutMs: number }) {
    super('timeout', true, describe(options, `timed out after ${options.timeoutMs} ms`), options);
    this.name = 'AITimeoutError';
  }
}

export class AIAuthError extends AIError {
  constructor(options: AIErrorOptions) {
    super('auth', false, describe(options, 'authentication or permission failed'), options);
    this.name = 'AIAuthError';
  }
}

export class AIInvalidRequestError extends AIError {
  constructor(options: AIErrorOptions, reason = 'invalid request') {
    super('invalid_request', false, describe(options, reason), options);
    this.name = 'AIInvalidRequestError';
  }
}

export class AIRefusalError extends AIError {
  /** Provider-reported safety category, when available. Informational only. */
  readonly category: string | null;
  constructor(options: AIErrorOptions & { category?: string | null }) {
    super('refusal', false, describe(options, 'the model declined the request'), options);
    this.name = 'AIRefusalError';
    this.category = options.category ?? null;
  }
}

export class AIDisabledError extends AIError {
  constructor(options: AIErrorOptions = { provider: 'disabled' }) {
    super('disabled', false, 'AI is disabled', options);
    this.name = 'AIDisabledError';
  }
}

/** Server errors (5xx) and network failures before a response. */
export class AIUnavailableError extends AIError {
  constructor(options: AIErrorOptions, reason = 'service unavailable') {
    super('unavailable', true, describe(options, reason), options);
    this.name = 'AIUnavailableError';
  }
}

export class AIMalformedResponseError extends AIError {
  constructor(options: AIErrorOptions, reason = 'malformed response') {
    super('malformed_response', false, describe(options, reason), options);
    this.name = 'AIMalformedResponseError';
  }
}

/** The caller aborted the request (not a timeout). */
export class AIAbortedError extends AIError {
  constructor(options: AIErrorOptions) {
    super('aborted', false, describe(options, 'request aborted'), options);
    this.name = 'AIAbortedError';
  }
}

/** Invalid environment configuration. Names the variable, never its value. */
export class AIConfigurationError extends AIError {
  constructor(message: string) {
    super('configuration', false, message, { provider: 'config' });
    this.name = 'AIConfigurationError';
  }
}

export function isAIError(error: unknown): error is AIError {
  return error instanceof AIError;
}

/**
 * Classify an HTTP status into an AIError. Used by fetch-based providers; the
 * Anthropic provider maps the SDK's typed errors to the same classes.
 */
export function errorForStatus(status: number, options: Omit<AIErrorOptions, 'status'>): AIError {
  const withStatus = { ...options, status };
  if (status === 401 || status === 403) return new AIAuthError(withStatus);
  if (status === 408) return new AIUnavailableError(withStatus, 'request timeout');
  if (status === 429) return new AIRateLimitError(withStatus);
  if (status === OVERLOADED_STATUS || options.upstreamType === 'overloaded_error') {
    return new AIOverloadedError(withStatus);
  }
  if (status >= 500) return new AIUnavailableError(withStatus);
  return new AIInvalidRequestError(withStatus);
}

/** Anthropic's "overloaded" status; some OpenAI-compatible gateways reuse it. */
export const OVERLOADED_STATUS = 529;
