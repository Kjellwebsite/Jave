import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { sessions } from '@jave/database';
import { sha256Hex } from '../kernel/crypto';
import { banMember } from '../moderation/cases.service';
import type { UserActor } from '../permissions/actor';
import { coreJobHandlers } from '../registry';
import { createTestKit, type TestKit } from '../testing';
import { listMySessions, revokeMySession, revokeUserSessions } from './sessions.service';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const DAY_MS = 86_400_000;

describe('privacy: sessions', () => {
  let kit: TestKit;
  let member: UserActor;
  let other: UserActor;
  let mod: UserActor;
  let core: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    member = await kit.member({ roles: ['member'] });
    other = await kit.member({ roles: ['member'] });
    mod = await kit.member({ roles: ['moderator'] });
    core = await kit.member({ roles: ['core'] });
  });
  afterEach(async () => {
    await kit.close();
  });

  let seq = 0;
  async function session(
    actor: UserActor,
    options: { expiresInMs?: number; revoked?: boolean } = {},
  ) {
    const now = kit.clock.now().getTime();
    const [row] = await kit.db
      .insert(sessions)
      .values({
        userId: actor.userId,
        tokenHash: sha256Hex(`token-${seq++}`),
        userAgent: 'Mozilla/5.0',
        ipHash: sha256Hex('203.0.113.9'),
        expiresAt: new Date(now + (options.expiresInMs ?? DAY_MS)),
        revokedAt: options.revoked ? new Date(now) : null,
      })
      .returning();
    return row!;
  }

  async function live(actor: UserActor) {
    return listMySessions(kit.as(actor));
  }

  it('lists only your own live sessions, without secrets', async () => {
    const mine = await session(member);
    await session(member, { revoked: true });
    await session(member, { expiresInMs: -1 });
    await session(other);
    const listed = await live(member);
    expect(listed.map((s) => s.id)).toEqual([mine.id]);
    expect(Object.keys(listed[0]!)).not.toContain('tokenHash');
    expect(Object.keys(listed[0]!)).not.toContain('ipHash');
  });

  it('ends one of your sessions, never someone else’s', async () => {
    const mine = await session(member);
    const theirs = await session(other);
    await revokeMySession(kit.as(member), { sessionId: mine.id });
    expect(await live(member)).toEqual([]);
    await expect(revokeMySession(kit.as(member), { sessionId: theirs.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await live(other)).toHaveLength(1);
  });

  it('signs you out everywhere', async () => {
    await session(member);
    await session(member);
    await session(other);
    expect(await revokeUserSessions(kit.as(member), { userId: member.userId })).toEqual({
      revoked: 2,
    });
    expect(await live(member)).toEqual([]);
    expect(await live(other)).toHaveLength(1);
  });

  it('lets staff end a lower-ranked account’s sessions, with a reason', async () => {
    await session(member);
    await expect(
      revokeUserSessions(kit.as(other), { userId: member.userId, reason: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(revokeUserSessions(kit.as(mod), { userId: member.userId })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(
      revokeUserSessions(kit.as(mod), { userId: core.userId, reason: 'compromised' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(
      await revokeUserSessions(kit.as(mod), { userId: member.userId, reason: 'compromised' }),
    ).toEqual({ revoked: 1 });
  });

  it('a ban ends the banned account’s sessions', async () => {
    await session(member);
    await banMember(kit.as(core), { targetUserId: member.userId, reason: 'Spam wave.' });
    await kit.drain(coreJobHandlers());
    expect(await live(member)).toEqual([]);
    const rows = await kit.db.select().from(sessions).where(eq(sessions.userId, member.userId));
    expect(rows[0]!.revokedAt).not.toBeNull();
  });
});
