import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { MINUTE, resolveUserActor, systemActor, withActor } from '@jave/core';
import { createTestKit, type TestKit } from '@jave/core/testing';
import { sessions, users } from '@jave/database';
import { DEV_PERSONAS, provisionDevPersona } from './dev-personas';
import { allowAuthAttempt, AUTH_RATE_LIMITS } from './rate-limits';
import {
  createSession,
  revokeSession,
  SESSION_TOUCH_INTERVAL_MS,
  SESSION_TTL_MS,
  validateSession,
} from './session-store';
import { hashSessionToken, newSessionToken } from './tokens';

let kit: TestKit;

beforeEach(async () => {
  kit = await createTestKit();
});

afterEach(async () => {
  await kit.close();
});

async function newUser() {
  const actor = await kit.member({ roles: ['verified'] });
  return actor.userId;
}

describe('sessions', () => {
  it('creates a session that resolves to its user, storing only the token hash', async () => {
    const userId = await newUser();
    const created = await createSession(kit.system, {
      userId,
      userAgent: 'vitest',
      ipHash: 'a'.repeat(64),
    });
    const [row] = await kit.db.select().from(sessions).where(eq(sessions.id, created.sessionId));
    expect(row!.tokenHash).toBe(hashSessionToken(created.token));
    expect(JSON.stringify(row)).not.toContain(created.token);
    expect(row!.expiresAt.getTime() - kit.clock.now().getTime()).toBe(SESSION_TTL_MS);

    const valid = await validateSession(kit.system, created.token);
    expect(valid).toMatchObject({ sessionId: created.sessionId, userId });
  });

  it('expires after 30 days', async () => {
    const created = await createSession(kit.system, { userId: await newUser() });
    kit.clock.advance(SESSION_TTL_MS - 1);
    expect(await validateSession(kit.system, created.token)).not.toBeNull();
    kit.clock.advance(1);
    expect(await validateSession(kit.system, created.token)).toBeNull();
  });

  it('throttles last_seen_at updates', async () => {
    const created = await createSession(kit.system, { userId: await newUser() });
    const lastSeen = async () =>
      (
        await kit.db.select().from(sessions).where(eq(sessions.id, created.sessionId))
      )[0]!.lastSeenAt.getTime();
    const start = await lastSeen();
    kit.clock.advance(SESSION_TOUCH_INTERVAL_MS - MINUTE);
    await validateSession(kit.system, created.token);
    expect(await lastSeen()).toBe(start);
    kit.clock.advance(2 * MINUTE);
    await validateSession(kit.system, created.token);
    expect(await lastSeen()).toBe(kit.clock.now().getTime());
  });

  it('revokes on logout and never resolves again', async () => {
    const userId = await newUser();
    const created = await createSession(kit.system, { userId });
    expect(await revokeSession(kit.system, created.token)).toMatchObject({ userId });
    expect(await validateSession(kit.system, created.token)).toBeNull();
    expect(await revokeSession(kit.system, created.token)).toBeNull();
  });

  it('BREAK: unknown, malformed and orphaned tokens resolve to nothing', async () => {
    expect(await validateSession(kit.system, newSessionToken())).toBeNull();
    expect(await validateSession(kit.system, "x' or '1'='1")).toBeNull();
    expect(await revokeSession(kit.system, 'not-a-token')).toBeNull();

    const userId = await newUser();
    const created = await createSession(kit.system, { userId });
    await kit.db.update(users).set({ deletedAt: kit.clock.now() }).where(eq(users.id, userId));
    expect(await validateSession(kit.system, created.token)).toBeNull();
  });

  it('BREAK: a session token is not interchangeable with its stored hash', async () => {
    const created = await createSession(kit.system, { userId: await newUser() });
    expect(await validateSession(kit.system, hashSessionToken(created.token))).toBeNull();
  });
});

describe('dev personas (MOCK / DEVELOPMENT ONLY)', () => {
  it('provisions each persona idempotently with exactly its role', async () => {
    const ctx = withActor(kit.system, systemActor('dev-login'));
    for (const persona of DEV_PERSONAS) {
      const first = await provisionDevPersona(ctx, persona);
      const second = await provisionDevPersona(ctx, persona);
      expect(second.id).toBe(first.id);
      const actor = await resolveUserActor(kit.system, first.id);
      expect(actor.discordId).toBe(persona.discordId);
      expect(actor.roles).toContain(persona.role);
    }
    const founder = await resolveUserActor(
      kit.system,
      (await provisionDevPersona(ctx, DEV_PERSONAS[0]!)).id,
    );
    expect(founder.capabilities.has('canManageSettings')).toBe(true);
    const member = await resolveUserActor(
      kit.system,
      (await provisionDevPersona(ctx, DEV_PERSONAS.at(-1)!)).id,
    );
    expect(member.capabilities.has('canViewAuditLogs')).toBe(false);
    expect(member.capabilities.has('canViewSettings')).toBe(false);
  });
});

describe('auth rate limits', () => {
  it('allows the window budget, refuses the next attempt, and resets with the window', async () => {
    const { limit, windowSeconds } = AUTH_RATE_LIMITS.login;
    for (let attempt = 0; attempt < limit; attempt++) {
      expect(await allowAuthAttempt(kit.system, 'login', 'client-a')).toBe(true);
    }
    expect(await allowAuthAttempt(kit.system, 'login', 'client-a')).toBe(false);
    expect(await allowAuthAttempt(kit.system, 'login', 'client-b')).toBe(true);
    expect(await allowAuthAttempt(kit.system, 'callback', 'client-a')).toBe(true);
    kit.clock.advance(windowSeconds * 1000 + 1);
    expect(await allowAuthAttempt(kit.system, 'login', 'client-a')).toBe(true);
  });
});
