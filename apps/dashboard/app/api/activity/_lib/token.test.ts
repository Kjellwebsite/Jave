import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HOUR, MINUTE } from '@jave/core';
import { signValue } from '@/server/auth/signed-value';
import {
  ACTIVITY_TOKEN_MAX_TTL_MS,
  ACTIVITY_TOKEN_TTL_MS,
  issueActivityToken,
  MAX_ACTIVITY_TOKEN_LENGTH,
  verifyActivityToken,
} from './token';

const SECRET = 'activity-test-secret-activity-test-secret-01';
const OTHER_SECRET = 'activity-test-secret-activity-test-secret-02';
const NOW = new Date('2026-09-25T12:00:00.000Z');
const USER_ID = randomUUID();
const INSTANCE = 'i-1263209785744457798-gc-1087860016624631818';
const PURPOSE = 'jave.activity-token.v1';

function issue(now = NOW) {
  return issueActivityToken(
    { userId: USER_ID, instanceId: INSTANCE, mode: 'discord' },
    SECRET,
    now,
  );
}

/** Signs arbitrary claims with the real secret and purpose, to probe claim validation. */
function forge(claims: Record<string, unknown>, secret = SECRET): string {
  return signValue(JSON.stringify(claims), secret, PURPOSE);
}

const validClaims = () => ({
  v: 1,
  sub: USER_ID,
  iid: INSTANCE,
  iat: NOW.getTime(),
  exp: NOW.getTime() + ACTIVITY_TOKEN_TTL_MS,
  mode: 'discord',
});

describe('activity token', () => {
  it('round-trips user, instance and mode, and lives at most two hours', () => {
    const issued = issue();
    expect(issued.expiresAt - NOW.getTime()).toBe(ACTIVITY_TOKEN_TTL_MS);
    expect(ACTIVITY_TOKEN_TTL_MS).toBeLessThanOrEqual(2 * HOUR);
    expect(verifyActivityToken(issued.token, SECRET, NOW)).toMatchObject({
      sub: USER_ID,
      iid: INSTANCE,
      mode: 'discord',
    });
  });

  it('expires exactly at exp', () => {
    const { token, expiresAt } = issue();
    expect(verifyActivityToken(token, SECRET, new Date(expiresAt - 1))).not.toBeNull();
    expect(verifyActivityToken(token, SECRET, new Date(expiresAt))).toBeNull();
  });

  it('BREAK: a tampered payload, a flipped signature or another secret never verifies', () => {
    const { token } = issue();
    const [body, mac] = token.split('.');
    const claims = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const otherUser = Buffer.from(JSON.stringify({ ...claims, sub: randomUUID() })).toString(
      'base64url',
    );
    expect(verifyActivityToken(`${otherUser}.${mac}`, SECRET, NOW)).toBeNull();
    const otherInstance = Buffer.from(JSON.stringify({ ...claims, iid: 'i-2' })).toString(
      'base64url',
    );
    expect(verifyActivityToken(`${otherInstance}.${mac}`, SECRET, NOW)).toBeNull();
    const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    expect(verifyActivityToken(flipped, SECRET, NOW)).toBeNull();
    expect(verifyActivityToken(token, OTHER_SECRET, NOW)).toBeNull();
  });

  it('BREAK: a value signed for another purpose (OAuth state, …) is not a token', () => {
    const signed = signValue(JSON.stringify(validClaims()), SECRET, 'jave.oauth-state.v1');
    expect(verifyActivityToken(signed, SECRET, NOW)).toBeNull();
  });

  it('BREAK: correctly signed but invalid claims are rejected', () => {
    const cases: Record<string, unknown>[] = [
      { ...validClaims(), v: 2 },
      { ...validClaims(), sub: 'not-a-uuid' },
      { ...validClaims(), iid: 'bad instance/../id' },
      { ...validClaims(), iid: 'x'.repeat(129) },
      { ...validClaims(), mode: 'staff' },
      { ...validClaims(), extra: true },
      { ...validClaims(), exp: undefined },
      // Lifetime above the ceiling, even though it has not expired.
      { ...validClaims(), exp: NOW.getTime() + ACTIVITY_TOKEN_MAX_TTL_MS + MINUTE },
      // Issued in the future.
      { ...validClaims(), iat: NOW.getTime() + 5 * MINUTE, exp: NOW.getTime() + HOUR },
      // exp before iat.
      { ...validClaims(), iat: NOW.getTime() - MINUTE, exp: NOW.getTime() - 2 * MINUTE },
    ];
    for (const claims of cases) {
      expect(verifyActivityToken(forge(claims), SECRET, NOW), JSON.stringify(claims)).toBeNull();
    }
    expect(verifyActivityToken(forge(validClaims()), SECRET, NOW)).not.toBeNull();
  });

  it('BREAK: malformed and oversized values are rejected before any parsing', () => {
    for (const value of ['', '.', 'abc', 'a.b.c', 'x'.repeat(MAX_ACTIVITY_TOKEN_LENGTH + 1)]) {
      expect(verifyActivityToken(value, SECRET, NOW), value.slice(0, 20)).toBeNull();
    }
    const notJson = signValue('not json', SECRET, PURPOSE);
    expect(verifyActivityToken(notJson, SECRET, NOW)).toBeNull();
  });
});
