import type { ActivityErrorBody } from './contract';

/** Requests that hang longer than this are treated as a lost connection. */
export const REQUEST_TIMEOUT_MS = 8_000;
const HTTP_UNAUTHORIZED = 401;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;

/** Status 0 = the request never got an answer (offline, timeout, proxy down). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly reference: string | null = null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get unauthenticated(): boolean {
    return this.status === HTTP_UNAUTHORIZED;
  }

  /** Worth retrying automatically: no answer, throttled, or a server-side failure. */
  get transient(): boolean {
    return (
      this.status === 0 ||
      this.status === HTTP_TOO_MANY_REQUESTS ||
      this.status >= HTTP_SERVER_ERROR
    );
  }
}

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export interface RequestOptions {
  token?: string | null;
  body?: unknown;
  query?: Record<string, string | null | undefined>;
}

function isErrorBody(value: unknown): value is ActivityErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const error = (value as { error?: unknown }).error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON (e.g. a proxy error page): fall through to the generic message.
  }
  if (isErrorBody(body)) {
    return new ApiError(
      response.status,
      body.error.code,
      body.error.message,
      body.error.reference ?? null,
      body.error.retryAfterSeconds ?? null,
    );
  }
  return new ApiError(response.status, 'HTTP_ERROR', 'The server did not answer as expected.');
}

/** Thin JSON transport for `/api/activity/*` on this origin. */
export class ApiClient {
  constructor(
    private readonly base: string,
    private readonly fetchFn: FetchFn = (input, init) => fetch(input, init),
  ) {}

  url(path: string, query?: RequestOptions['query']): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== null && value !== undefined) search.set(key, value);
    }
    const suffix = search.size > 0 ? `?${search.toString()}` : '';
    return `${this.base}${path}${suffix}`;
  }

  async request<T>(method: 'GET' | 'POST', path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (method === 'POST') headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await this.fetchFn(this.url(path, options.query), {
        method,
        headers,
        body: method === 'POST' ? JSON.stringify(options.body ?? {}) : undefined,
        cache: 'no-store',
        credentials: 'omit',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new ApiError(0, 'OFFLINE', 'Connection lost.');
    }
    if (!response.ok) throw await toApiError(response);
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError(response.status, 'HTTP_ERROR', 'The server did not answer as expected.');
    }
  }
}
