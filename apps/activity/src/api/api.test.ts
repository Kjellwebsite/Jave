import { describe, expect, it } from 'vitest';
import type { ActivityHost, AuthSession } from '../platform/hosts';
import { ApiClient, ApiError, type FetchFn } from './client';
import { ActivitySession, REFRESH_MARGIN_MS, ServerClock } from './session';

interface Call {
  url: string;
  init: RequestInit;
}

function stubFetch(responses: (Response | Error)[]): FetchFn & { calls: Call[] } {
  const calls: Call[] = [];
  const fn: FetchFn = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  };
  return Object.assign(fn, { calls });
}

const errorResponse = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  Response.json({ error: { code, message: `${code} message`, ...extra } }, { status });

describe('ApiClient', () => {
  it('sends JSON with the bearer token to the configured base, never with cookies', async () => {
    const fetch = stubFetch([Response.json({ ok: true })]);
    const client = new ApiClient('/.proxy/api', fetch);
    await client.request('POST', '/activity/trivia/move', {
      token: 'tok',
      body: { sessionId: 's', round: 1, choice: 2 },
    });
    const [call] = fetch.calls;
    expect(call!.url).toBe('/.proxy/api/activity/trivia/move');
    expect(call!.init.credentials).toBe('omit');
    expect(call!.init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(call!.init.body))).toEqual({ sessionId: 's', round: 1, choice: 2 });
  });

  it('encodes query parameters and skips empty ones', async () => {
    const fetch = stubFetch([Response.json({})]);
    await new ApiClient('/api', fetch).request('GET', '/activity/trivia/session', {
      query: { sessionId: 'a b&c', other: null },
    });
    expect(fetch.calls[0]!.url).toBe('/api/activity/trivia/session?sessionId=a+b%26c');
  });

  it('turns error bodies into ApiErrors with reference and retry hints', async () => {
    const fetch = stubFetch([
      errorResponse(429, 'RATE_LIMITED', { retryAfterSeconds: 7 }),
      errorResponse(500, 'INTERNAL', { reference: 'E-ABCDEFGH' }),
      new Response('<html>bad gateway</html>', { status: 502 }),
      new TypeError('Failed to fetch'),
    ]);
    const client = new ApiClient('/api', fetch);
    const attempt = () => client.request('GET', '/activity/me').catch((error: unknown) => error);
    const limited = (await attempt()) as ApiError;
    expect(limited).toMatchObject({ status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 7 });
    expect(limited.transient).toBe(true);
    expect(await attempt()).toMatchObject({ status: 500, reference: 'E-ABCDEFGH' });
    const proxy = (await attempt()) as ApiError;
    expect(proxy).toMatchObject({ status: 502, code: 'HTTP_ERROR' });
    expect(proxy.message).not.toContain('html');
    const offline = (await attempt()) as ApiError;
    expect(offline).toMatchObject({ status: 0, code: 'OFFLINE' });
    expect(offline.transient).toBe(true);
  });
});

describe('ActivitySession', () => {
  function host(sessions: AuthSession[]): ActivityHost & { signIns: number } {
    const state = { signIns: 0 };
    return {
      mode: 'dev',
      instanceId: 'dev-arena',
      get signIns() {
        return state.signIns;
      },
      async signIn() {
        const next = sessions[Math.min(state.signIns, sessions.length - 1)]!;
        state.signIns++;
        return next;
      },
    };
  }

  const auth = (token: string, expiresAt: number): AuthSession => ({
    token,
    expiresAt,
    mode: 'dev',
    displayName: 'Dev',
    instanceId: 'dev-arena',
  });

  it('shares one sign-in between concurrent callers and feeds the server clock', async () => {
    let local = 1_000;
    const clock = new ServerClock(() => local);
    const fetch = stubFetch([Response.json({ serverNow: 5_000 }), Response.json({ serverNow: 5_000 })]);
    const h = host([auth('t1', 10_000_000)]);
    const session = new ActivitySession(h, new ApiClient('/api', fetch), clock);
    await Promise.all([session.call('GET', '/activity/me'), session.call('GET', '/activity/me')]);
    expect(h.signIns).toBe(1);
    expect(clock.now()).toBe(5_000);
    local += 250;
    expect(clock.now()).toBe(5_250);
  });

  it('re-signs in silently before the token expires', async () => {
    let local = 0;
    const clock = new ServerClock(() => local);
    const fetch = stubFetch([Response.json({}), Response.json({})]);
    const h = host([auth('t1', REFRESH_MARGIN_MS + 1_000), auth('t2', 10 * REFRESH_MARGIN_MS)]);
    const session = new ActivitySession(h, new ApiClient('/api', fetch), clock);
    await session.call('GET', '/activity/me');
    expect(h.signIns).toBe(1);
    local += 1_000;
    await session.call('GET', '/activity/me');
    expect(h.signIns).toBe(2);
    expect(fetch.calls[0]!.init.headers).toMatchObject({ Authorization: 'Bearer t1' });
    expect(fetch.calls[1]!.init.headers).toMatchObject({ Authorization: 'Bearer t2' });
  });

  it('BREAK: a 401 triggers exactly one re-sign-in and retry', async () => {
    const clock = new ServerClock(() => 0);
    const fetch = stubFetch([
      errorResponse(401, 'UNAUTHENTICATED'),
      Response.json({ ok: 1 }),
      errorResponse(401, 'UNAUTHENTICATED'),
      errorResponse(401, 'UNAUTHENTICATED'),
    ]);
    const h = host([auth('t1', 1e12), auth('t2', 1e12), auth('t3', 1e12), auth('t4', 1e12)]);
    const session = new ActivitySession(h, new ApiClient('/api', fetch), clock);
    await expect(session.call('GET', '/activity/me')).resolves.toEqual({ ok: 1 });
    expect(h.signIns).toBe(2);
    await expect(session.call('GET', '/activity/me')).rejects.toMatchObject({ status: 401 });
    expect(h.signIns).toBe(3);
  });
});
