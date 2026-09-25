import { describe, expect, it } from 'vitest';
import { hmacSha256Hex } from '../kernel/crypto';
import { integrationConfigSchema, integrationSlugSchema, relayChannelOf } from './config';
import { MAX_JSON_DEPTH, REPLAY_WINDOW_MS } from './constants';
import { buildRelayPayload, relaySummary, sanitizeRelayText } from './discord-jobs';
import { maskUrl } from './outbound.service';
import { isPubliclyVisible } from './outbound.subscriber';
import { cleanLine, headline, neutralizeMentions, parseJsonObject } from './payload';
import { signGithub, signJave, verifyGithubSignature, verifyJaveSignature } from './signatures';

const SECRET = 'whsec_test_secret';
const NOW = new Date('2026-03-01T12:00:00.000Z');
const nowSeconds = String(Math.floor(NOW.getTime() / 1000));

describe('GitHub signatures', () => {
  const body = '{"zen":"Keep it logically awesome."}';

  it('accepts a valid sha256 signature', () => {
    expect(verifyGithubSignature(SECRET, body, signGithub(SECRET, body))).toBe(true);
  });

  it.each([
    ['missing header', undefined],
    ['wrong secret', signGithub('other', body)],
    ['legacy sha1 prefix', `sha1=${hmacSha256Hex(SECRET, body)}`],
    ['truncated digest', signGithub(SECRET, body).slice(0, -2)],
    ['non-hex digest', `sha256=${'z'.repeat(64)}`],
    ['empty', ''],
  ])('rejects %s', (_label, header) => {
    expect(verifyGithubSignature(SECRET, body, header)).toBe(false);
  });

  it('rejects a signature for a different body (tampering)', () => {
    expect(verifyGithubSignature(SECRET, `${body} `, signGithub(SECRET, body))).toBe(false);
  });
});

describe('JAVE v1 signatures', () => {
  const body = '{"text":"deploy finished"}';
  const verify = (overrides: Partial<Parameters<typeof verifyJaveSignature>[0]>) =>
    verifyJaveSignature({
      secret: SECRET,
      timestamp: nowSeconds,
      signature: signJave(SECRET, nowSeconds, body),
      body,
      now: NOW,
      windowMs: REPLAY_WINDOW_MS,
      ...overrides,
    });

  it('accepts a fresh, valid signature', () => {
    expect(verify({})).toEqual({ ok: true });
  });

  it('binds the timestamp into the signature', () => {
    const other = String(Number(nowSeconds) - 1);
    expect(verify({ timestamp: other })).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('BREAK: rejects replays outside ±5 minutes, in both directions', () => {
    const old = String(Number(nowSeconds) - REPLAY_WINDOW_MS / 1000 - 1);
    const future = String(Number(nowSeconds) + REPLAY_WINDOW_MS / 1000 + 1);
    expect(verify({ timestamp: old, signature: signJave(SECRET, old, body) })).toEqual({
      ok: false,
      reason: 'timestamp_out_of_range',
    });
    expect(verify({ timestamp: future, signature: signJave(SECRET, future, body) })).toEqual({
      ok: false,
      reason: 'timestamp_out_of_range',
    });
    const edge = String(Number(nowSeconds) - REPLAY_WINDOW_MS / 1000);
    expect(verify({ timestamp: edge, signature: signJave(SECRET, edge, body) })).toEqual({
      ok: true,
    });
  });

  it.each([
    ['missing timestamp', { timestamp: undefined }, 'missing_headers'],
    ['missing signature', { signature: undefined }, 'missing_headers'],
    ['float timestamp', { timestamp: '1.5' }, 'malformed_timestamp'],
    ['millisecond timestamp', { timestamp: `${nowSeconds}000000` }, 'malformed_timestamp'],
    ['unversioned signature', { signature: hmacSha256Hex(SECRET, body) }, 'malformed_signature'],
    ['v0 signature', { signature: `v0=${'a'.repeat(64)}` }, 'malformed_signature'],
    ['wrong secret', { signature: signJave('nope', nowSeconds, body) }, 'signature_mismatch'],
  ] as const)('rejects %s', (_label, overrides, reason) => {
    expect(verify(overrides)).toEqual({ ok: false, reason });
  });

  it('accepts any matching entry in a multi-signature header (secret rotation)', () => {
    const header = `${signJave('old', nowSeconds, body)}, ${signJave(SECRET, nowSeconds, body)}`;
    expect(verify({ signature: header })).toEqual({ ok: true });
  });
});

describe('inbound JSON', () => {
  it('parses objects and strips NUL characters Postgres cannot store', () => {
    const result = parseJsonObject('{"a\\u0000b":"x\\u0000y","n":[{"m":"\\u0000"}]}');
    expect(result).toEqual({ ok: true, value: { ab: 'xy', n: [{ m: '' }] } });
  });

  it.each([
    ['{not json', 'malformed_json'],
    ['', 'malformed_json'],
    ['[1,2]', 'not_an_object'],
    ['"string"', 'not_an_object'],
    ['null', 'not_an_object'],
  ])('rejects %j as %s', (raw, reason) => {
    expect(parseJsonObject(raw)).toEqual({ ok: false, reason });
  });

  it('BREAK: a "__proto__" key stays data and pollutes nothing', () => {
    const result = parseJsonObject('{"__proto__":{"polluted":true},"a":{"__proto__":{"x":1}}}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
    expect((result.value as { polluted?: boolean }).polluted).toBeUndefined();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect(JSON.stringify(result.value)).toBe(
      '{"__proto__":{"polluted":true},"a":{"__proto__":{"x":1}}}',
    );
  });

  it('BREAK: bounds nesting depth', () => {
    const deep = `${'{"a":'.repeat(MAX_JSON_DEPTH + 5)}1${'}'.repeat(MAX_JSON_DEPTH + 5)}`;
    expect(parseJsonObject(deep)).toEqual({ ok: false, reason: 'too_deep' });
    const absurd = `${'['.repeat(200_000)}${']'.repeat(200_000)}`;
    expect(parseJsonObject(`{"a":${absurd}}`).ok).toBe(false);
  });
});

describe('text sanitizing', () => {
  it('flattens control characters and bounds length', () => {
    expect(cleanLine('a\u0000b\nc\u009b d', 100)).toBe('a b c d');
    expect(cleanLine('x'.repeat(50), 10)).toBe(`${'x'.repeat(9)}…`);
    expect(headline('fix: parser\n\nlong body', 80)).toBe('fix: parser');
  });

  it('neutralizes every Discord mention form', () => {
    const text = neutralizeMentions('@everyone @here <@123456789012345678> <@&1> <#2>');
    expect(text).not.toMatch(/@everyone|@here|<@\d|<@&|<#\d/);
  });

  it('builds relay payloads from untrusted JSON', () => {
    expect(relaySummary({ text: '@everyone deploy done\n' })).toBe('@​everyone deploy done');
    expect(relaySummary({ nested: { text: 'x' } })).toBe('Event received.');
    expect(relaySummary({ text: '\u0001\u0002', message: 'fallback field' })).toBe(
      'fallback field',
    );
    expect(relaySummary({ text: '\u0007' })).toBe('Event received.');
    expect(relaySummary(['text'])).toBe('Event received.');
    const payload = buildRelayPayload({
      deliveryId: '00000000-0000-4000-8000-000000000000',
      channelId: '123456789012345678',
      integrationName: 'CI <@1>',
      eventType: 'deploy',
      payload: { message: 'y'.repeat(5000) },
    });
    expect(payload.title).toBe('CI <@​1> · deploy');
    expect(payload.text.length).toBeLessThanOrEqual(1500);
    expect(sanitizeRelayText('@here', 3).length).toBeLessThanOrEqual(3);
  });
});

describe('integration config', () => {
  it('accepts flat non-secret config and a relay channel', () => {
    expect(
      integrationConfigSchema.parse({ relayChannelId: '123456789012345678', env: 'prod' }),
    ).toEqual({ relayChannelId: '123456789012345678', env: 'prod' });
    expect(relayChannelOf({ relayChannelId: '123456789012345678' })).toBe('123456789012345678');
    expect(relayChannelOf({ relayChannelId: 42 })).toBeNull();
  });

  it.each([
    [{ apiKey: 'x' }],
    [{ webhookSecret: 'x' }],
    [{ accessToken: 'x' }],
    [{ relayChannelId: 'general' }],
    [{ nested: { a: 1 } }],
    [{ 'bad key': 1 }],
    [Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, i]))],
  ])('BREAK: rejects %j', (config) => {
    expect(integrationConfigSchema.safeParse(config).success).toBe(false);
  });

  it('validates slugs', () => {
    expect(integrationSlugSchema.parse(' GitHub-Main ')).toBe('github-main');
    for (const slug of ['ab', '-abc', 'abc-', 'a/b', '../x', 'a'.repeat(49)]) {
      expect(integrationSlugSchema.safeParse(slug).success).toBe(false);
    }
  });
});

describe('outbound helpers', () => {
  it('masks webhook URLs down to their origin', () => {
    expect(maskUrl('https://hooks.example.com/api/webhooks/1/SECRET-TOKEN')).toBe(
      'https://hooks.example.com/…',
    );
    expect(maskUrl('https://example.com')).toBe('https://example.com');
    expect(maskUrl('https://example.com/?token=x')).toBe('https://example.com/…');
  });

  it('only public (or visibility-less) events leave JAVE', () => {
    expect(isPubliclyVisible({ payload: {} })).toBe(true);
    expect(isPubliclyVisible({ payload: { visibility: 'public' } })).toBe(true);
    expect(isPubliclyVisible({ payload: { visibility: 'members' } })).toBe(false);
    expect(isPubliclyVisible({ payload: { visibility: 'private' } })).toBe(false);
  });
});
