import { AIConfigurationError, AIMalformedResponseError } from './errors';

/** The subset of `fetch` providers use. Injectable so tests never touch the network. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface RequestDeadline {
  signal: AbortSignal;
  /** True when the deadline (not the caller) aborted the request. */
  timedOut(): boolean;
  dispose(): void;
}

/** Combine the caller's signal with a per-attempt timeout. Always call `dispose`. */
export function createDeadline(timeoutMs: number, parent?: AbortSignal): RequestDeadline {
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort(new Error(`deadline of ${timeoutMs} ms exceeded`));
  }, timeoutMs);
  const onParentAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) onParentAbort();
  else parent?.addEventListener('abort', onParentAbort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => expired,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParentAbort);
    },
  };
}

/**
 * Read a response body as text, refusing bodies larger than `maxBytes`
 * (protects the process from hostile or misconfigured endpoints).
 */
export async function readTextCapped(
  response: Response,
  maxBytes: number,
  provider: string,
): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new AIMalformedResponseError({ provider }, 'response too large');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new AIMalformedResponseError({ provider }, 'response too large');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(concat(chunks, total));
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

const LOOPBACK_HOSTS = new Set(['localhost', '[::1]', '::1']);
const IPV4_LOOPBACK = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(host) || IPV4_LOOPBACK.test(host);
}

/**
 * Validate a provider base URL: http(s) only, no embedded credentials, and
 * plain http only for loopback hosts (local model servers) so API keys never
 * travel unencrypted.
 */
export function validateBaseUrl(raw: string, variable: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AIConfigurationError(`${variable} must be a valid URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AIConfigurationError(`${variable} must use http(s)`);
  }
  if (url.username || url.password) {
    throw new AIConfigurationError(`${variable} must not embed credentials`);
  }
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    throw new AIConfigurationError(`${variable} must use https for non-local hosts`);
  }
  return url;
}

/** Join a base URL and a path without doubling or dropping slashes. */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
