import { z } from 'zod';
import {
  MAX_SIDUS_EXTERNAL_ID_LENGTH,
  SIDUS_MAX_RESPONSE_BYTES,
  SIDUS_TIMEOUT_MS,
} from './constants';
import {
  boundedFetch,
  defaultFetch,
  type FetchLike,
  HttpTransportError,
  isRetryableStatus,
  isSafeServiceUrl,
} from './http';

/**
 * SIDUS SCIENCE integration. JAVE pushes VERIFIED research items to Sidus;
 * the exact HTTP contract is documented in docs/modules/research.md.
 * Nothing is ever faked: without configuration, sync is recorded as
 * `not_synced` with the reason.
 */

/** What JAVE sends to Sidus. Deliberately contains no member identity. */
export interface SidusResearchItem {
  /** JAVE research item id; Sidus upserts on it. */
  externalRef: string;
  title: string;
  authors: string[];
  doi: string | null;
  arxivId: string | null;
  url: string | null;
  canonicalUrl: string | null;
  topic: string | null;
  tags: string[];
  summary: string | null;
  evidenceLevel: string;
  publishedOn: string | null;
  verifiedAt: string | null;
  source: 'jave';
}

export interface SidusHealth {
  ok: boolean;
  detail: string;
}

/** Extension point: any transport that can upsert a verified item into Sidus. */
export interface SidusClient {
  readonly configured: boolean;
  pushItem(item: SidusResearchItem): Promise<{ externalId: string }>;
  health(): Promise<SidusHealth>;
}

export const SIDUS_NOT_CONFIGURED_REASON = 'Sidus integration is not configured.';

export class SidusNotConfiguredError extends Error {
  constructor() {
    super(SIDUS_NOT_CONFIGURED_REASON);
    this.name = 'SidusNotConfiguredError';
  }
}

export class SidusSyncError extends Error {
  readonly retryable: boolean;
  constructor(reason: string, retryable: boolean) {
    super(reason);
    this.name = 'SidusSyncError';
    this.retryable = retryable;
  }
}

/** Used when SIDUS_API_URL / SIDUS_API_KEY are absent. Never pretends to sync. */
export class NotConfiguredSidusClient implements SidusClient {
  readonly configured = false;

  async pushItem(): Promise<{ externalId: string }> {
    throw new SidusNotConfiguredError();
  }

  async health(): Promise<SidusHealth> {
    return {
      ok: false,
      detail: `${SIDUS_NOT_CONFIGURED_REASON} Set SIDUS_API_URL and SIDUS_API_KEY.`,
    };
  }
}

const upsertResponseSchema = z.object({
  id: z.string().min(1).max(MAX_SIDUS_EXTERNAL_ID_LENGTH),
});

export interface HttpSidusClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

/**
 * Sidus over HTTPS: `PUT {baseUrl}/v1/research-items/by-external-ref/{id}`
 * (idempotent upsert) and `GET {baseUrl}/v1/health`. Bearer auth, no
 * redirects, bounded responses.
 */
export class HttpSidusClient implements SidusClient {
  readonly configured = true;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: HttpSidusClientOptions) {
    if (!isSafeServiceUrl(options.baseUrl)) {
      throw new Error('SIDUS_API_URL must be https (or http on loopback) without credentials');
    }
    if (!options.apiKey.trim()) throw new Error('SIDUS_API_KEY must not be empty');
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey.trim();
    this.fetchImpl = options.fetch ?? defaultFetch;
    this.timeoutMs = options.timeoutMs ?? SIDUS_TIMEOUT_MS;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.apiKey}`,
      accept: 'application/json',
      'content-type': 'application/json',
    };
  }

  async pushItem(item: SidusResearchItem): Promise<{ externalId: string }> {
    const url = `${this.baseUrl}/v1/research-items/by-external-ref/${encodeURIComponent(item.externalRef)}`;
    let response;
    try {
      response = await boundedFetch(this.fetchImpl, url, {
        method: 'PUT',
        headers: this.headers(),
        body: JSON.stringify(item),
        timeoutMs: this.timeoutMs,
        maxBytes: SIDUS_MAX_RESPONSE_BYTES,
      });
    } catch (error) {
      const failure = error instanceof HttpTransportError ? error.failure : 'network';
      throw new SidusSyncError(`Sidus request failed: ${failure}.`, failure !== 'too_large');
    }
    if (!response.ok) {
      const auth = response.status === 401 || response.status === 403;
      throw new SidusSyncError(
        auth ? 'Sidus rejected the credentials.' : `Sidus responded with HTTP ${response.status}.`,
        isRetryableStatus(response.status),
      );
    }
    let json: unknown;
    try {
      json = JSON.parse(response.text);
    } catch {
      throw new SidusSyncError('Sidus returned a response that is not JSON.', false);
    }
    const parsed = upsertResponseSchema.safeParse(json);
    if (!parsed.success) throw new SidusSyncError('Sidus returned an unexpected response.', false);
    return { externalId: parsed.data.id };
  }

  async health(): Promise<SidusHealth> {
    try {
      const response = await boundedFetch(this.fetchImpl, `${this.baseUrl}/v1/health`, {
        headers: this.headers(),
        timeoutMs: this.timeoutMs,
        maxBytes: SIDUS_MAX_RESPONSE_BYTES,
      });
      return response.ok
        ? { ok: true, detail: 'Sidus reachable' }
        : { ok: false, detail: `Sidus responded with HTTP ${response.status}` };
    } catch (error) {
      const failure = error instanceof HttpTransportError ? error.failure : 'network';
      return { ok: false, detail: `Sidus unreachable (${failure})` };
    }
  }
}

export interface SidusConfig {
  baseUrl?: string;
  apiKey?: string;
  fetch?: FetchLike;
}

/** HTTP client when both URL and key are configured; otherwise the honest not-configured client. */
export function createSidusClient(config: SidusConfig): SidusClient {
  if (!config.baseUrl || !config.apiKey) return new NotConfiguredSidusClient();
  return new HttpSidusClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    fetch: config.fetch,
  });
}
