import { type AIError, type AIErrorKind, isAIError } from './errors';

/** Retries after the first attempt. The brief caps this at two. */
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_RETRY_BASE_DELAY_MS = 500;
/** Upper bound for any single wait, including a server-provided retry-after. */
export const DEFAULT_RETRY_MAX_DELAY_MS = 10_000;

/**
 * Failure classes retried automatically. Timeouts are retryable by the caller
 * but not retried here, to keep worst-case latency bounded for interactive use.
 */
const AUTO_RETRY_KINDS: ReadonlySet<AIErrorKind> = new Set([
  'rate_limited',
  'overloaded',
  'unavailable',
]);

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export const realSleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  sleep: Sleep;
  /** Returns [0, 1). Injected for deterministic tests. */
  random: () => number;
}

export function retryPolicy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  return {
    maxRetries: DEFAULT_MAX_RETRIES,
    baseDelayMs: DEFAULT_RETRY_BASE_DELAY_MS,
    maxDelayMs: DEFAULT_RETRY_MAX_DELAY_MS,
    sleep: realSleep,
    random: Math.random,
    ...overrides,
  };
}

export function shouldRetry(error: unknown): error is AIError {
  return isAIError(error) && AUTO_RETRY_KINDS.has(error.kind);
}

/** Exponential backoff with jitter (50–100 % of the step); honours retry-after. */
export function retryDelayMs(error: AIError, retryIndex: number, policy: RetryPolicy): number {
  if (error.retryAfterMs !== undefined) return Math.min(error.retryAfterMs, policy.maxDelayMs);
  const step = policy.baseDelayMs * 2 ** retryIndex;
  return Math.min(Math.round(step * (0.5 + policy.random() / 2)), policy.maxDelayMs);
}

/** Run `attempt` with automatic retries for transient provider failures. */
export async function withRetry<T>(
  attempt: () => Promise<T>,
  policy: RetryPolicy,
  signal?: AbortSignal,
): Promise<T> {
  for (let retryIndex = 0; ; retryIndex++) {
    try {
      return await attempt();
    } catch (error) {
      if (!shouldRetry(error) || retryIndex >= policy.maxRetries || signal?.aborted) throw error;
      await policy.sleep(retryDelayMs(error, retryIndex, policy), signal);
    }
  }
}

/** Parse `retry-after` (seconds or HTTP date) / `retry-after-ms` headers. */
export function parseRetryAfterMs(
  headers: Headers,
  nowMs: number = Date.now(),
): number | undefined {
  const ms = headers.get('retry-after-ms');
  if (ms !== null && /^\d+(\.\d+)?$/.test(ms.trim())) return Math.round(Number(ms));
  const value = headers.get('retry-after');
  if (value === null) return undefined;
  if (/^\d+(\.\d+)?$/.test(value.trim())) return Math.round(Number(value) * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - nowMs);
}
