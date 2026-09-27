import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestKit, type TestKit } from '@jave/core/testing';
import { auditLogs, sessions } from '@jave/database';
import { createSession, validateSession } from './session-store';
import { endSession, startSession } from './sign-in';

let kit: TestKit;

beforeEach(async () => {
  kit = await createTestKit();
});

afterEach(async () => {
  await kit.close();
});

const DEV_LOGIN = {
  action: 'auth.dev_login',
  context: { persona: 'verified', mock: true },
} as const;

/** Makes every audit insert fail, as a lost connection or full disk would mid-transaction. */
async function breakAuditStore(): Promise<void> {
  await kit.database.exec(`
    create function test_fail_audit() returns trigger language plpgsql as $$
    begin raise exception 'audit store unavailable'; end $$;
    create trigger test_fail_audit before insert on audit_logs
      for each row execute function test_fail_audit();
  `);
}

async function auditActions(): Promise<string[]> {
  const rows = await kit.db.select({ action: auditLogs.action }).from(auditLogs);
  return rows.map((row) => row.action);
}

describe('sign-in and sign-out are atomic with their audit entries', () => {
  it('starts a session, rotates the previous one, and audits the sign-in as the user', async () => {
    const actor = await kit.member({ roles: ['verified'] });
    const previous = await createSession(kit.system, { userId: actor.userId });

    const session = await startSession(kit.system, {
      userId: actor.userId,
      previousToken: previous.token,
      userAgent: 'vitest',
      audit: DEV_LOGIN,
    });

    expect(await validateSession(kit.system, session.token)).toMatchObject({
      userId: actor.userId,
    });
    expect(await validateSession(kit.system, previous.token)).toBeNull();
    const [entry] = await kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'auth.dev_login'));
    expect(entry).toMatchObject({
      actorType: 'user',
      actorUserId: actor.userId,
      targetType: 'user',
      targetId: actor.userId,
      context: { persona: 'verified', mock: true },
    });
  });

  it('BREAK: when the audit entry cannot be written, no session exists and the old one survives', async () => {
    const actor = await kit.member({ roles: ['verified'] });
    const previous = await createSession(kit.system, { userId: actor.userId });
    await breakAuditStore();

    await expect(
      startSession(kit.system, {
        userId: actor.userId,
        previousToken: previous.token,
        audit: { action: 'auth.login', context: { method: 'discord_oauth' } },
      }),
    ).rejects.toThrow();

    const rows = await kit.db.select().from(sessions).where(eq(sessions.userId, actor.userId));
    expect(rows.map((row) => row.id)).toEqual([previous.sessionId]);
    expect(await validateSession(kit.system, previous.token)).not.toBeNull();
  });

  it('ends a session and audits auth.logout', async () => {
    const actor = await kit.member({ roles: ['verified'] });
    const session = await createSession(kit.system, { userId: actor.userId });

    expect(await endSession(kit.system, session.token)).toMatchObject({ userId: actor.userId });
    expect(await validateSession(kit.system, session.token)).toBeNull();
    expect(await auditActions()).toContain('auth.logout');

    // A dead token ends nothing and records nothing.
    expect(await endSession(kit.system, session.token)).toBeNull();
    expect((await auditActions()).filter((action) => action === 'auth.logout')).toHaveLength(1);
  });

  it('BREAK: when auth.logout cannot be written, the revocation rolls back and the caller sees the error', async () => {
    const actor = await kit.member({ roles: ['verified'] });
    const session = await createSession(kit.system, { userId: actor.userId });
    await breakAuditStore();

    await expect(endSession(kit.system, session.token)).rejects.toThrow();
    expect(await validateSession(kit.system, session.token)).not.toBeNull();
  });
});
