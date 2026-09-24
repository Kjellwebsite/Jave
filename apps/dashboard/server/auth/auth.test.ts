import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { dashboardEnvSchema, EnvError, parseEnv } from '@jave/config';
import { DEV_PERSONAS, findDevPersona, isDevAuthEnabled } from './dev-auth';
import {
  buildAuthorizeUrl,
  createDiscordOAuthClient,
  type FetchLike,
  oauthRedirectUri,
} from './discord-oauth';
import {
  createOAuthState,
  decodeOAuthState,
  encodeOAuthState,
  OAUTH_STATE_TTL_MS,
} from './oauth-state';
import { createPkceVerifier, pkceChallenge } from './pkce';
import { signValue, verifySignedValue } from './signed-value';
import {
  hashClientIp,
  hashSessionToken,
  isWellFormedSessionToken,
  newSessionToken,
} from './tokens';

const SECRET = 'test-session-secret-test-session-secret-0001';
const OTHER_SECRET = 'test-session-secret-test-session-secret-0002';
const PURPOSE = 'jave.test.v1';
const NOW = new Date('2026-09-24T12:00:00.000Z');

describe('signed values (HMAC-SHA256)', () => {
  it('round-trips a payload', () => {
    const signed = signValue('{"a":1}', SECRET, PURPOSE);
    expect(verifySignedValue(signed, SECRET, PURPOSE)).toBe('{"a":1}');
  });

  it('BREAK: rejects a tampered payload', () => {
    const signed = signValue('{"next":"/overview"}', SECRET, PURPOSE);
    const [, mac] = signed.split('.');
    const forged = `${Buffer.from('{"next":"/settings"}').toString('base64url')}.${mac}`;
    expect(verifySignedValue(forged, SECRET, PURPOSE)).toBeNull();
  });

  it('BREAK: rejects a tampered signature, another secret, or another purpose', () => {
    const signed = signValue('payload', SECRET, PURPOSE);
    const flipped = signed.slice(0, -1) + (signed.endsWith('A') ? 'B' : 'A');
    expect(verifySignedValue(flipped, SECRET, PURPOSE)).toBeNull();
    expect(verifySignedValue(signed, OTHER_SECRET, PURPOSE)).toBeNull();
    expect(verifySignedValue(signed, SECRET, 'jave.other.v1')).toBeNull();
  });

  it('BREAK: rejects malformed values', () => {
    for (const value of ['', '.', 'abc', '.sig', 'a.b.c', 'payload.']) {
      expect(verifySignedValue(value, SECRET, PURPOSE), value).toBeNull();
    }
  });
});

describe('OAuth state cookie', () => {
  it('round-trips state, verifier and next path', () => {
    const state = createOAuthState('/members?role=core', NOW);
    const decoded = decodeOAuthState(encodeOAuthState(state, SECRET), SECRET, NOW);
    expect(decoded).toEqual(state);
    expect(decoded?.next).toBe('/members?role=core');
  });

  it('expires after its TTL', () => {
    const signed = encodeOAuthState(createOAuthState(null, NOW), SECRET);
    const later = new Date(NOW.getTime() + OAUTH_STATE_TTL_MS);
    expect(decodeOAuthState(signed, SECRET, later)).toBeNull();
  });

  it('BREAK: never carries an off-site redirect', () => {
    for (const next of [
      '//evil.example',
      'https://evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
    ]) {
      expect(createOAuthState(next, NOW).next, next).toBe('/overview');
    }
  });

  it('BREAK: rejects missing, forged, oversized and non-JSON cookies', () => {
    expect(decodeOAuthState(undefined, SECRET, NOW)).toBeNull();
    expect(decodeOAuthState('x'.repeat(5000), SECRET, NOW)).toBeNull();
    expect(
      decodeOAuthState(signValue('not json', SECRET, 'jave.oauth-state.v1'), SECRET, NOW),
    ).toBeNull();
    const wrongShape = signValue(JSON.stringify({ state: 'short' }), SECRET, 'jave.oauth-state.v1');
    expect(decodeOAuthState(wrongShape, SECRET, NOW)).toBeNull();
    const state = encodeOAuthState(createOAuthState(null, NOW), OTHER_SECRET);
    expect(decodeOAuthState(state, SECRET, NOW)).toBeNull();
  });
});

describe('PKCE', () => {
  it('matches the RFC 7636 appendix B test vector', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('creates 43-character unreserved verifiers, unique per call', () => {
    const verifiers = new Set(Array.from({ length: 50 }, () => createPkceVerifier()));
    expect(verifiers.size).toBe(50);
    for (const verifier of verifiers) expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('session tokens', () => {
  it('are 32 random bytes, base64url', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => newSessionToken()));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(isWellFormedSessionToken(token)).toBe(true);
  });

  it('are stored only as a SHA-256 hash', () => {
    const token = newSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });

  it('BREAK: rejects malformed tokens before any lookup', () => {
    for (const token of [
      '',
      'short',
      `${newSessionToken()}x`,
      "' or 1=1 --".padEnd(43, 'a'),
      'a'.repeat(42) + '=',
    ]) {
      expect(isWellFormedSessionToken(token), token).toBe(false);
    }
  });

  it('hashes client IPs with a key, so raw addresses are never stored', () => {
    const a = hashClientIp('203.0.113.7', SECRET);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(hashClientIp('203.0.113.7', OTHER_SECRET));
    expect(a).not.toBe(createHash('sha256').update('203.0.113.7').digest('hex'));
  });
});

describe('dev login guard (MOCK / DEVELOPMENT ONLY)', () => {
  it.each([
    [true, 'development', true],
    [true, 'test', true],
    [true, 'production', false],
    [false, 'development', false],
    [false, 'production', false],
  ] as const)('JAVE_DEV_AUTH=%s NODE_ENV=%s → %s', (flag, nodeEnv, expected) => {
    expect(isDevAuthEnabled({ JAVE_DEV_AUTH: flag, NODE_ENV: nodeEnv })).toBe(expected);
  });

  it('BREAK: a production environment with dev auth refuses to boot', () => {
    expect(() =>
      parseEnv(dashboardEnvSchema, {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://localhost/jave',
        DISCORD_CLIENT_ID: '200000000000000001',
        DISCORD_GUILD_ID: '300000000000000001',
        DISCORD_CLIENT_SECRET: 'secret',
        JAVE_SESSION_SECRET: SECRET,
        JAVE_DEV_AUTH: 'true',
      }),
    ).toThrow(EnvError);
  });

  it('defines one deterministic persona per role under test', () => {
    expect(DEV_PERSONAS.map((persona) => persona.discordId)).toEqual([
      '100000000000000001',
      '100000000000000002',
      '100000000000000003',
      '100000000000000004',
      '100000000000000005',
      '100000000000000006',
    ]);
    expect(DEV_PERSONAS.map((persona) => persona.role)).toEqual([
      'founder',
      'core',
      'operations',
      'moderator',
      'verified',
      'member',
    ]);
    expect(findDevPersona('founder')?.role).toBe('founder');
    expect(findDevPersona('admin')).toBeNull();
    expect(findDevPersona('__proto__')).toBeNull();
  });
});

describe('Discord OAuth client', () => {
  it('builds an S256 authorization URL for the identify scope only', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: '200000000000000001',
        redirectUri: oauthRedirectUri('https://jave.example'),
        state: 'state-value',
        codeChallenge: 'challenge-value',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: '200000000000000001',
      scope: 'identify',
      state: 'state-value',
      code_challenge: 'challenge-value',
      code_challenge_method: 'S256',
      redirect_uri: 'https://jave.example/api/auth/discord/callback',
    });
  });

  /** TEST ONLY — a scripted stand-in for Discord's HTTP API. */
  function scriptedFetch(
    responses: Record<string, Response>,
    calls: { url: string; init: RequestInit }[],
  ): FetchLike {
    return async (url, init) => {
      calls.push({ url, init });
      const response = responses[url];
      if (!response) throw new Error(`unexpected request to ${url}`);
      return response;
    };
  }

  it('exchanges the code with the PKCE verifier and maps the profile', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = createDiscordOAuthClient({
      clientId: '200000000000000001',
      clientSecret: 'client-secret',
      fetch: scriptedFetch(
        {
          'https://discord.com/api/oauth2/token': Response.json({
            access_token: 'access-1',
            token_type: 'Bearer',
          }),
          'https://discord.com/api/users/@me': Response.json({
            id: '110000000000000011',
            username: 'mara',
            global_name: 'Mara Voss',
            avatar: 'a_0123456789abcdef0123456789abcdef',
          }),
        },
        calls,
      ),
    });
    const token = await client.exchangeCode({
      code: 'code-1',
      codeVerifier: 'verifier-1',
      redirectUri: 'https://jave.example/cb',
    });
    expect(token).toBe('access-1');
    const body = new URLSearchParams(String(calls[0]!.init.body));
    expect(body.get('code_verifier')).toBe('verifier-1');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(calls[0]!.init.method).toBe('POST');

    const profile = await client.fetchProfile(token);
    expect(profile).toEqual({
      discordId: '110000000000000011',
      username: 'mara',
      displayName: 'Mara Voss',
      avatarHash: 'a_0123456789abcdef0123456789abcdef',
      isBot: false,
    });
    expect((calls[1]!.init.headers as Record<string, string>).Authorization).toBe(
      'Bearer access-1',
    );
  });

  it('BREAK: fails closed on errors and unexpected shapes, without echoing the body', async () => {
    const client = createDiscordOAuthClient({
      clientId: '200000000000000001',
      clientSecret: 'client-secret',
      fetch: scriptedFetch(
        {
          'https://discord.com/api/oauth2/token': new Response(
            '{"error":"invalid_grant","secret":"leak"}',
            { status: 400 },
          ),
          'https://discord.com/api/users/@me': Response.json({
            id: 'not-a-snowflake',
            username: 'x',
          }),
        },
        [],
      ),
    });
    await expect(
      client.exchangeCode({ code: 'c', codeVerifier: 'v', redirectUri: 'r' }),
    ).rejects.toThrow(/HTTP 400/);
    await expect(
      client.exchangeCode({ code: 'c', codeVerifier: 'v', redirectUri: 'r' }),
    ).rejects.not.toThrow(/leak/);
    await expect(client.fetchProfile('t')).rejects.toThrow(/unexpected shape/);
  });
});
