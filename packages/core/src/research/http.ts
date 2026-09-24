import { isLoopbackHost } from '@jave/ai';

/** The subset of `fetch` the research module uses. Injectable for tests. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Resolved lazily so tests and runtimes that replace `fetch` are honoured. */
export const defaultFetch: FetchLike = (input, init) => fetch(input, init);

export type HttpFailure = 'timeout' | 'network' | 'too_large';

/** A transport failure before a usable response. Always retryable. */
export class HttpTransportError extends Error {
  readonly failure: HttpFailure;
  constructor(failure: HttpFailure) {
    super(`request failed: ${failure}`);
    this.name = 'HttpTransportError';
    this.failure = failure;
  }
}

export interface BoundedRequest {
  method?: 'GET' | 'PUT' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxBytes: number;
}

export interface BoundedResponse {
  status: number;
  ok: boolean;
  text: string;
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (Number(response.headers.get('content-length') ?? '0') > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new HttpTransportError('too_large');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new HttpTransportError('too_large');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * One HTTP request with a hard timeout, a response size cap and no
 * redirects (credentials must never follow a redirect to another host).
 */
export async function boundedFetch(
  fetchImpl: FetchLike,
  url: string,
  request: BoundedRequest,
): Promise<BoundedResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: request.method ?? 'GET',
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
      redirect: 'error',
    });
    const text = await readCapped(response, request.maxBytes);
    return { status: response.status, ok: response.ok, text };
  } catch (error) {
    if (error instanceof HttpTransportError) throw error;
    throw new HttpTransportError(controller.signal.aborted ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
}

/** http(s) only, no embedded credentials, plain http only for loopback. */
export function isSafeServiceUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.username || url.password) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

/** True for statuses worth retrying later (rate limits, server errors). */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}
