import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, memberCapabilities, memberNotes } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { ForbiddenError } from '../kernel/errors';
import { setEvaluatorNotes } from './capabilities.service';
import { addMemberNote, listMemberNotes, mayHandleMemberNotes } from './profile.service';

/**
 * Staff notes and evaluator notes follow the rule for moderation records:
 * nobody reads or writes the notes about themselves, and staff handle notes
 * only about members ranked strictly below them.
 */
describe('staff notes and evaluator notes', () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
  });
  afterEach(async () => {
    await kit.close();
  });

  it('staff read and write notes about members ranked below them', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const mod = await kit.member({ roles: ['moderator'] });
    const member = await kit.member();
    await addMemberNote(kit.as(ops), member.memberId!, 'Asked about the build trial.');
    await addMemberNote(kit.as(ops), mod.memberId!, 'Handles the evening queue.');

    expect(await listMemberNotes(kit.as(mod), member.memberId!)).toHaveLength(1);
    expect(await listMemberNotes(kit.as(ops), mod.memberId!)).toHaveLength(1);
    expect(await mayHandleMemberNotes(kit.system, mod.memberId!)).toBe(true);
  });

  it('BREAK: a moderator cannot read the notes written about them', async () => {
    const core = await kit.member({ roles: ['core'] });
    const mod = await kit.member({ roles: ['moderator'] });
    await addMemberNote(kit.as(core), mod.memberId!, 'Complaint about timeouts; under review.');

    await expect(listMemberNotes(kit.as(mod), mod.memberId!)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await mayHandleMemberNotes(kit.as(mod), mod.memberId!)).toBe(false);
    const denied = await kit.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'access.denied'), eq(auditLogs.targetId, mod.memberId!)));
    expect(denied).toHaveLength(1);
  });

  it('BREAK: staff cannot read or write notes about members at or above their rank', async () => {
    const founder = await kit.member({ roles: ['founder'] });
    const core = await kit.member({ roles: ['core'] });
    const mod = await kit.member({ roles: ['moderator'] });
    const otherMod = await kit.member({ roles: ['moderator'] });
    const ops = await kit.member({ roles: ['operations'] });
    await addMemberNote(kit.as(founder), core.memberId!, 'Owns the trials calendar.');

    await expect(listMemberNotes(kit.as(mod), core.memberId!)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(listMemberNotes(kit.as(mod), otherMod.memberId!)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      addMemberNote(kit.as(ops), core.memberId!, 'Seems overloaded.'),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      addMemberNote(kit.as(core), core.memberId!, 'Note to self.'),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // A founder handles everyone but themselves.
    expect(await listMemberNotes(kit.as(founder), core.memberId!)).toHaveLength(1);
    await expect(
      addMemberNote(kit.as(founder), founder.memberId!, 'Note to self.'),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await kit.db.select().from(memberNotes)).toHaveLength(1);
  });

  it('BREAK: an evaluator cannot rewrite the evaluator notes about themselves', async () => {
    const evaluator = await kit.member({ roles: ['core'] });
    const colleague = await kit.member({ roles: ['core'] });
    await setEvaluatorNotes(kit.as(colleague), {
      memberId: evaluator.memberId!,
      facetKey: 'mind.reasoning',
      notes: 'Weak reasoning in the last trial.',
    });

    await expect(
      setEvaluatorNotes(kit.as(evaluator), {
        memberId: evaluator.memberId!,
        facetKey: 'mind.reasoning',
        notes: 'Outstanding in the last trial.',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const [row] = await kit.db
      .select()
      .from(memberCapabilities)
      .where(eq(memberCapabilities.memberId, evaluator.memberId!));
    expect(row!.notes).toBe('Weak reasoning in the last trial.');
    const blocked = await kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'rank.self_notes_blocked'));
    expect(blocked).toHaveLength(1);
  });
});
