import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { externalAccounts, members, users } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { type ServiceContext, withTransaction } from '../kernel/context';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  ValidationError,
} from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { activeRoles, DISCORD_ROLE_SYNC_JOB } from '../identity/users.service';
import { enqueueJob } from '../jobs/queue';
import { authorize, requireUser } from '../permissions/authorize';
import { isStaffRole } from '../permissions/roles';
import { ERASED_DISPLAY_NAME, ERASED_MARKER, MAX_REASON_LENGTH } from './constants';
import {
  authoredTitles,
  deletePersonalRows,
  eraseAuthoredText,
  eraseIdentity,
  type ErasureCounts,
  type ErasureTarget,
  relatedRecordIds,
  scrubKeptRecords,
} from './erasure-steps';
import { scrubTerms } from './scrub';

export const eraseMemberSchema = z.object({
  memberId: z.uuid(),
  reason: z.string().trim().min(1, 'Give a reason.').max(MAX_REASON_LENGTH),
  /** The member's current handle, typed by the founder: erasure cannot be undone. */
  confirmHandle: z.string().trim().max(64),
});

export interface ErasureReport {
  memberId: string;
  userId: string;
  erasedAt: Date;
  counts: ErasureCounts;
}

/**
 * Erase a departed member's personal data (pseudonymization). Founders only
 * (`canManagePrivacy`), with a reason and the member's handle typed as
 * confirmation. One transaction; audited `privacy.erased`.
 *
 * Refused for yourself, for anyone still in the server (they would be
 * re-created on their next interaction), for anyone holding a staff role, and
 * for a member already erased.
 *
 * Kept, pseudonymous: the Discord ID (keeps a ban enforceable and the account
 * from being silently re-created with its old history), moderation cases,
 * rank history, trial results, application decisions, audit logs and domain
 * events — the organization's record. See docs/modules/privacy.md.
 */
export async function eraseMember(
  ctx: ServiceContext,
  input: z.input<typeof eraseMemberSchema>,
): Promise<ErasureReport> {
  const data = parseInput(eraseMemberSchema, input);
  const actor = requireUser(ctx);
  await authorize(ctx, 'canManagePrivacy', { type: 'member', id: data.memberId });

  return withTransaction(ctx, async (tx) => {
    const [row] = await tx.db
      .select({ member: members, user: users })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(eq(members.id, data.memberId))
      .for('update');
    if (!row) throw new NotFoundError('Member');
    const { member, user } = row;
    if (member.deletedAt) throw new ConflictError('This member’s data was already erased.');
    if (member.userId === actor.userId) {
      throw new ForbiddenError('You cannot erase your own data. Ask another founder.');
    }
    if (member.guildStatus === 'present') {
      throw new InvalidStateError(
        'This member is still in the server. They must leave (or be removed) before their data can be erased.',
      );
    }
    const roles = await activeRoles(tx, member.id);
    if (roles.some(isStaffRole)) {
      throw new InvalidStateError('This member holds a staff role. Revoke it first.');
    }
    if (data.confirmHandle.toLowerCase() !== member.handle.toLowerCase()) {
      throw new ValidationError('Type the member’s handle exactly to confirm.', [
        { path: 'confirmHandle', message: `Type ${member.handle} to confirm.` },
      ]);
    }

    const linked = await tx.db
      .select({ username: externalAccounts.username })
      .from(externalAccounts)
      .where(eq(externalAccounts.memberId, member.id));
    const terms = scrubTerms({
      username: user.username,
      userDisplayName: user.displayName,
      memberDisplayName: member.displayName,
      handle: member.handle,
      otherNames: linked.map((account) => account.username),
    });
    const target: ErasureTarget = {
      userId: user.id,
      memberId: member.id,
      actorUserId: actor.userId,
      relatedIds: await relatedRecordIds(tx, { userId: user.id, memberId: member.id }),
    };
    const rules = [
      { terms, replacement: ERASED_DISPLAY_NAME },
      { terms: await authoredTitles(tx, user.id), replacement: ERASED_MARKER },
    ];

    // Scrub kept records first, while the rows that name the person still do.
    const counts: ErasureCounts = {
      ...(await scrubKeptRecords(tx, target, rules)),
      ...(await eraseAuthoredText(tx, target)),
      ...(await deletePersonalRows(tx, target)),
      ...(await eraseIdentity(tx, target)),
    };
    // Discord follows: a deleted member keeps no mapped roles.
    await enqueueJob(
      tx,
      DISCORD_ROLE_SYNC_JOB,
      { memberId: member.id },
      { dedupeKey: `roles-sync:${member.id}`, rerunIfRunning: true },
    );
    await recordAudit(tx, {
      action: 'privacy.erased',
      targetType: 'member',
      targetId: member.id,
      context: { reason: data.reason, counts },
    });
    return { memberId: member.id, userId: user.id, erasedAt: tx.clock.now(), counts };
  });
}
