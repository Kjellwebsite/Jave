import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, like } from 'drizzle-orm';
import { anonymousActor, ExternalServiceError } from '@jave/core';
import { createTestKit, nextDiscordId, type TestKit } from '@jave/core/testing';
import { auditLogs, members, rateLimitBuckets, users } from '@jave/database';
import type {
  ActivityErrorBody,
  ActivityTokenResponse,
  DevPersonasResponse,
  MissionControlResponse,
} from '../contract';
import { type ActivityDiscordClient, createActivityDiscordClient } from '../discord';
import type { FetchLike } from '@/server/auth/discord-oauth';
import { ACTIVITY_RATE_LIMITS } from '../limits';
import {
  apiRequest,
  fakeDiscord,
  INSTANCE,
  readJson,
  TEST_SECRET,
  testDeps,
} from '../testing/support';
import { ACTIVITY_TOKEN_TTL_MS, verifyActivityToken } from '../token';
import { handleDevPersonas, handleDevToken, handleTokenExchange } from './auth';
import { handleMissionControl } from './mission-control';

let kit: TestKit;

beforeEach(async () => {
  kit = await createTestKit();
});

afterEach(async () => {
  await kit.close();
});

const exchange = (body: unknown, headers: Record<string, string> = {}) =>
  apiRequest('POST', '/token', { body, headers });

describe('POST /api/activity/token', () => {
  it('exchanges the code, provisions the user and issues a token bound to user + instance', async () => {
    const discordId = nextDiscordId();
    const discord = fakeDiscord({ discordId, username: 'orbit' });
    const response = await handleTokenExchange(
      exchange({ code: 'valid-code', instanceId: INSTANCE }),
      testDeps(kit, { discord }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await readJson<ActivityTokenResponse>(response);
    expect(body).toMatchObject({
      access_token: 'discord-access-token-test',
      mode: 'discord',
      user: { discordId, displayName: 'orbit' },
    });
    expect(body.expiresAt - kit.clock.now().getTime()).toBe(ACTIVITY_TOKEN_TTL_MS);

    const [user] = await kit.db.select().from(users).where(eq(users.discordId, discordId));
    const claims = verifyActivityToken(body.jave_token, TEST_SECRET, kit.clock.now());
    expect(claims).toMatchObject({ sub: user!.id, iid: INSTANCE, mode: 'discord' });
    // A launch never implies guild membership.
    const [member] = await kit.db.select().from(members).where(eq(members.userId, user!.id));
    expect(member!.guildStatus).toBe('never_joined');
    const audits = await kit.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'auth.login'), eq(auditLogs.targetId, user!.id)));
    expect(audits[0]!.context).toMatchObject({ method: 'discord_activity' });
    expect(JSON.stringify(audits)).not.toContain('discord-access-token-test');
  });

  it('the issued token opens Mission Control', async () => {
    const discord = fakeDiscord({ discordId: nextDiscordId(), username: 'vector' });
    const deps = testDeps(kit, { discord });
    const issued = await readJson<ActivityTokenResponse>(
      await handleTokenExchange(exchange({ code: 'valid-code', instanceId: INSTANCE }), deps),
    );
    const me = await handleMissionControl(
      apiRequest('GET', '/me', { token: issued.jave_token }),
      deps,
    );
    expect(me.status).toBe(200);
    const body = await readJson<MissionControlResponse>(me);
    expect(body.profile?.displayName).toBe('vector');
    // No roles yet (never joined the guild): cannot host games.
    expect(body.canHostGames).toBe(false);
  });

  it('is unavailable (503) when Discord OAuth is not configured', async () => {
    const response = await handleTokenExchange(
      exchange({ code: 'valid-code', instanceId: INSTANCE }),
      testDeps(kit),
    );
    expect(response.status).toBe(503);
    expect((await readJson<ActivityErrorBody>(response)).error.code).toBe('DISABLED');
  });

  it('BREAK: refuses bot accounts', async () => {
    const discord = fakeDiscord({ discordId: nextDiscordId(), username: 'bot', isBot: true });
    const response = await handleTokenExchange(
      exchange({ code: 'valid-code', instanceId: INSTANCE }),
      testDeps(kit, { discord }),
    );
    expect(response.status).toBe(403);
    expect(await kit.db.select().from(users)).toHaveLength(0);
  });

  it('BREAK: a rejected code is a calm 502 that echoes nothing from Discord', async () => {
    const discord = fakeDiscord({ discordId: nextDiscordId(), username: 'x' });
    const response = await handleTokenExchange(
      exchange({ code: 'stolen-or-used', instanceId: INSTANCE }),
      testDeps(kit, { discord }),
    );
    expect(response.status).toBe(502);
    const body = await readJson<ActivityErrorBody>(response);
    expect(body.error.code).toBe('EXTERNAL_SERVICE');
    expect(JSON.stringify(body)).not.toContain('stolen-or-used');
  });

  it('BREAK: an instance the verifier rejects gets no token', async () => {
    const discord = fakeDiscord({ discordId: nextDiscordId(), username: 'x' });
    const response = await handleTokenExchange(
      exchange({ code: 'valid-code', instanceId: INSTANCE }),
      testDeps(kit, { discord, instanceVerifier: async () => false }),
    );
    expect(response.status).toBe(403);
  });

  it('BREAK: malformed bodies are refused before Discord is called', async () => {
    const discord = fakeDiscord({ discordId: nextDiscordId(), username: 'x' });
    const deps = testDeps(kit, { discord });
    const cases: [Request, number][] = [
      [exchange({ code: 'valid-code' }), 400],
      [exchange({ code: 'valid-code', instanceId: '../../etc' }), 400],
      [exchange({ code: 'valid code; drop', instanceId: INSTANCE }), 400],
      [exchange({ code: 'valid-code', instanceId: INSTANCE, admin: true }), 400],
      [exchange({ code: 'x'.repeat(600), instanceId: INSTANCE }), 400],
      [apiRequest('POST', '/token', { rawBody: '{not json', headers: {} }), 400],
      [
        apiRequest('POST', '/token', {
          rawBody: 'code=valid-code',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
        }),
        415,
      ],
      [apiRequest('POST', '/token', { rawBody: JSON.stringify({ pad: 'x'.repeat(4000) }) }), 413],
    ];
    for (const [request, status] of cases) {
      const response = await handleTokenExchange(request, deps);
      expect(response.status).toBe(status);
    }
    expect(discord.exchanged).toHaveLength(0);
  });

  it('BREAK: the per-client circuit breaker answers 429 with Retry-After and spares Discord', async () => {
    const discord = fakeDiscord({ discordId: nextDiscordId(), username: 'x' });
    const logger = kit.as(anonymousActor).logger.child({});
    const warn = vi.spyOn(logger, 'warn');
    const deps = testDeps(kit, { discord, context: () => ({ ...kit.as(anonymousActor), logger }) });
    const headers = { 'x-forwarded-for': '203.0.113.9' };
    const { limit } = ACTIVITY_RATE_LIMITS.token;
    let last: Response | null = null;
    for (let i = 0; i <= limit; i++) {
      last = await handleTokenExchange(
        exchange({ code: 'nope', instanceId: INSTANCE }, headers),
        deps,
      );
    }
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(discord.exchanged).toHaveLength(limit);
    // Operators hear about it once per window, not once per refused request.
    const exhausted = warn.mock.calls.filter(
      ([, message]) => message === 'activity budget exhausted',
    );
    expect(exhausted).toHaveLength(1);
    expect(JSON.stringify(exhausted)).not.toContain('203.0.113.9');
  });

  it('BREAK: requests that can never reach Discord spend nothing of the shared budget', async () => {
    const discord = fakeDiscord({ discordId: nextDiscordId(), username: 'orbit' });
    const deps = testDeps(kit, { discord });
    // What a member can fire from devtools inside the Activity: no body, junk, wrong shapes.
    const junk = () => [
      apiRequest('POST', '/token'),
      apiRequest('POST', '/token', { rawBody: '' }),
      apiRequest('POST', '/token', { rawBody: '{not json' }),
      exchange({ code: 'valid-code' }),
      exchange({ code: '', instanceId: INSTANCE }),
    ];
    for (let round = 0; round <= ACTIVITY_RATE_LIMITS.token.limit / junk().length; round++) {
      for (const request of junk())
        expect((await handleTokenExchange(request, deps)).status).not.toBe(200);
    }
    const spent = await kit.db
      .select()
      .from(rateLimitBuckets)
      .where(like(rateLimitBuckets.key, 'activity:token:%'));
    expect(spent).toEqual([]);
    expect(discord.exchanged).toHaveLength(0);
    const signedIn = await handleTokenExchange(
      exchange({ code: 'valid-code', instanceId: INSTANCE }),
      deps,
    );
    expect(signedIn.status).toBe(200);
  });

  it('a whole event launching in the same minute through one proxy address all get in', async () => {
    const launches = 75;
    const accounts = new Map<string, string>();
    const discord: ActivityDiscordClient = {
      async exchange(code) {
        const discordId = accounts.get(code);
        if (!discordId) throw new ExternalServiceError('discord', 'Discord token exchange failed.');
        return {
          accessToken: `at-${code}`,
          profile: { discordId, username: code, displayName: code, avatarHash: null, isBot: false },
        };
      },
    };
    const deps = testDeps(kit, { discord });
    const proxy = { 'x-forwarded-for': '198.51.100.20' };
    for (let i = 0; i < launches; i++) {
      const code = `launch-${i}`;
      accounts.set(code, nextDiscordId());
      const response = await handleTokenExchange(
        exchange({ code, instanceId: INSTANCE }, proxy),
        deps,
      );
      expect(response.status, code).toBe(200);
    }
  });
});

describe('Discord code exchange client', () => {
  function stubFetch(responses: Record<string, Response>): FetchLike & { calls: string[] } {
    const calls: string[] = [];
    const fn = async (input: string, init: RequestInit) => {
      calls.push(`${init.method} ${input} ${String(init.body ?? '')}`);
      const response = responses[input];
      if (!response) throw new Error(`unexpected fetch ${input}`);
      return response.clone();
    };
    return Object.assign(fn, { calls });
  }

  const tokenOk = (scope = 'identify') =>
    Response.json({ access_token: 'at-123', token_type: 'Bearer', scope, expires_in: 604800 });
  const meOk = () =>
    Response.json({
      id: '123456789012345678',
      username: 'nova',
      global_name: 'Nova',
      avatar: null,
    });

  it('exchanges without redirect URI or PKCE and reads the identity', async () => {
    const fetch = stubFetch({
      'https://discord.com/api/oauth2/token': tokenOk(),
      'https://discord.com/api/users/@me': meOk(),
    });
    const client = createActivityDiscordClient({ clientId: '1', clientSecret: 's3cret', fetch });
    const session = await client.exchange('abc');
    expect(session).toMatchObject({
      accessToken: 'at-123',
      profile: { discordId: '123456789012345678', username: 'nova', displayName: 'Nova' },
    });
    expect(fetch.calls[0]).toContain('grant_type=authorization_code');
    expect(fetch.calls[0]).not.toContain('redirect_uri');
    expect(fetch.calls[0]).not.toContain('code_verifier');
  });

  it('BREAK: refuses a grant without the identify scope and error bodies are never echoed', async () => {
    const noScope = createActivityDiscordClient({
      clientId: '1',
      clientSecret: 's',
      fetch: stubFetch({ 'https://discord.com/api/oauth2/token': tokenOk('guilds') }),
    });
    await expect(noScope.exchange('abc')).rejects.toThrow(/identify/);
    const failing = createActivityDiscordClient({
      clientId: '1',
      clientSecret: 's',
      fetch: stubFetch({
        'https://discord.com/api/oauth2/token': new Response('{"error":"invalid_grant s3cret"}', {
          status: 400,
        }),
      }),
    });
    await expect(failing.exchange('abc')).rejects.toThrow(
      'Discord token exchange failed (HTTP 400).',
    );
  });
});

describe('dev token — MOCK / DEVELOPMENT ONLY', () => {
  it('BREAK: does not exist (404) unless dev auth is enabled', async () => {
    const deps = testDeps(kit);
    expect((await handleDevPersonas(apiRequest('GET', '/dev-token'), deps)).status).toBe(404);
    const response = await handleDevToken(
      apiRequest('POST', '/dev-token', { body: { persona: 'founder', instanceId: INSTANCE } }),
      deps,
    );
    expect(response.status).toBe(404);
    expect(await kit.db.select().from(users)).toHaveLength(0);
  });

  it('lists personas and signs in as one, audited as a mock login', async () => {
    const deps = testDeps(kit, { devAuthEnabled: true });
    const list = await readJson<DevPersonasResponse>(
      await handleDevPersonas(apiRequest('GET', '/dev-token'), deps),
    );
    expect(list.personas.map((p) => p.key)).toContain('verified');
    expect(JSON.stringify(list)).not.toMatch(/discordId|1000000000/);

    const response = await handleDevToken(
      apiRequest('POST', '/dev-token', { body: { persona: 'verified', instanceId: 'dev-arena' } }),
      deps,
    );
    expect(response.status).toBe(200);
    const body = await readJson<ActivityTokenResponse>(response);
    expect(body).toMatchObject({ access_token: null, mode: 'dev' });
    expect(verifyActivityToken(body.jave_token, TEST_SECRET, kit.clock.now())).toMatchObject({
      iid: 'dev-arena',
      mode: 'dev',
    });
    const [audit] = await kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'auth.dev_login'));
    expect(audit!.context).toMatchObject({ persona: 'verified', mock: true, surface: 'activity' });

    const me = await readJson<MissionControlResponse>(
      await handleMissionControl(apiRequest('GET', '/me', { token: body.jave_token }), deps),
    );
    expect(me.profile?.displayName).toBe('Dev Verified');
    expect(me.canHostGames).toBe(true);
  });

  it('BREAK: unknown personas are refused', async () => {
    const deps = testDeps(kit, { devAuthEnabled: true });
    const response = await handleDevToken(
      apiRequest('POST', '/dev-token', { body: { persona: 'root', instanceId: INSTANCE } }),
      deps,
    );
    expect(response.status).toBe(400);
  });

  it('BREAK: a dev token stops working once dev auth is switched off', async () => {
    const enabled = testDeps(kit, { devAuthEnabled: true });
    const body = await readJson<ActivityTokenResponse>(
      await handleDevToken(
        apiRequest('POST', '/dev-token', { body: { persona: 'founder', instanceId: INSTANCE } }),
        enabled,
      ),
    );
    const disabled = testDeps(kit, { devAuthEnabled: false });
    const me = await handleMissionControl(
      apiRequest('GET', '/me', { token: body.jave_token }),
      disabled,
    );
    expect(me.status).toBe(401);
  });
});
