import type { FetchLike } from '../http';

/** Test double for `fetch`: scripted responses, recorded requests, no network. */
export interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

export type FakeRoute = (request: RecordedRequest, signal?: AbortSignal) => Promise<Response>;

export interface FakeFetch {
  fetch: FetchLike;
  requests: RecordedRequest[];
}

/** Each call consumes the next route; the last route repeats once the list is exhausted. */
export function createFakeFetch(routes: readonly FakeRoute[]): FakeFetch {
  const requests: RecordedRequest[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const recorded: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : '',
    };
    const route = routes[Math.min(requests.length, routes.length - 1)];
    requests.push(recorded);
    if (!route) throw new Error('fake fetch: no route configured');
    return route(recorded, init?.signal ?? undefined);
  };
  return { fetch: fetchImpl, requests };
}

export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): FakeRoute {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
}

export function text(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): FakeRoute {
  return async () => new Response(body, { status, headers });
}

/** Never answers; rejects like real fetch when the request is aborted. */
export function hang(): FakeRoute {
  return (_request, signal) =>
    new Promise<Response>((_resolve, reject) => {
      const abort = () => {
        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        reject(error);
      };
      if (signal?.aborted) abort();
      signal?.addEventListener('abort', abort, { once: true });
    });
}

export function networkError(): FakeRoute {
  return async () => {
    throw new TypeError('fetch failed');
  };
}

/** Records waits instead of sleeping. */
export function fakeSleep(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
}
