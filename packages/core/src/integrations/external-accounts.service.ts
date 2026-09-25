import { and, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { externalAccounts, members } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import {
  ConflictError,
  ForbiddenError,
  isUniqueViolation,
  NotFoundError,
  ValidationError,
} from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { notify } from '../notifications/notifications.service';
import { authorize, can, isSelf } from '../permissions/authorize';
import { requireActiveMember } from '../projects/access';

export type ExternalAccountRecord = typeof externalAccounts.$inferSelect;

/** GitHub login rules: 1–39 alphanumerics or single inner hyphens. Stored lowercase. */
export const GITHUB_LOGIN_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;
const GITHUB_USER_ID = /^\d{1,20}$/;
const PROVIDER = 'github' as const;

export const linkGithubAccountSchema = z.object({
  username: z
    .string()
    .max(64)
    .transform((value) => value.trim().replace(/^@/, '').toLowerCase())
    .pipe(z.string().regex(GITHUB_LOGIN_PATTERN, 'not a valid GitHub username')),
});

export const unlinkGithubAccountSchema = z.object({
  /** Defaults to yourself; unlinking someone else requires canVerifyMembers. */
  memberId: z.uuid().optional(),
});

export const setExternalAccountVerificationSchema = z.object({
  memberId: z.uuid(),
  verified: z.boolean(),
  /**
   * GitHub's numeric user id; binds the account so a renamed login cannot be
   * reclaimed. Required to verify an account that has none bound yet:
   * pull requests are matched to verified accounts by this id.
   */
  externalId: z.string().regex(GITHUB_USER_ID, 'must be a numeric GitHub user id').optional(),
});

export interface ExternalAccountView {
  provider: typeof PROVIDER;
  username: string;
  externalId: string | null;
  verified: boolean;
  verifiedAt: Date | null;
  profileUrl: string;
}

function toView(row: ExternalAccountRecord): ExternalAccountView {
  return {
    provider: PROVIDER,
    username: row.username,
    externalId: row.externalId,
    verified: row.verifiedAt !== null,
    verifiedAt: row.verifiedAt,
    profileUrl: `https://github.com/${row.username}`,
  };
}

async function findAccount(
  ctx: ServiceContext,
  memberId: string,
): Promise<ExternalAccountRecord | null> {
  const [row] = await ctx.db
    .select()
    .from(externalAccounts)
    .where(and(eq(externalAccounts.memberId, memberId), eq(externalAccounts.provider, PROVIDER)));
  return row ?? null;
}

const takenError = () =>
  new ConflictError('That GitHub account is already linked to another member.');

/**
 * Self-declared GitHub link (unverified). Changing the username resets
 * verification: staff must verify the new identity again.
 */
export async function linkGithubAccount(
  ctx: ServiceContext,
  input: z.input<typeof linkGithubAccountSchema>,
): Promise<ExternalAccountView> {
  const actor = requireActiveMember(ctx);
  const data = parseInput(linkGithubAccountSchema, input);
  const existing = await findAccount(ctx, actor.memberId);
  if (existing && existing.username === data.username) return toView(existing);
  try {
    return await withTransaction(ctx, async (t) => {
      const now = t.clock.now();
      const values = {
        username: data.username,
        externalId: null,
        verifiedAt: null,
        verifiedByUserId: null,
        updatedAt: now,
      };
      const [row] = existing
        ? await t.db
            .update(externalAccounts)
            .set(values)
            .where(eq(externalAccounts.id, existing.id))
            .returning()
        : await t.db
            .insert(externalAccounts)
            .values({ ...values, memberId: actor.memberId, provider: PROVIDER, createdAt: now })
            .returning();
      await recordAudit(t, {
        action: 'external_account.linked',
        targetType: 'member',
        targetId: actor.memberId,
        context: {
          provider: PROVIDER,
          username: data.username,
          previous: existing?.username ?? null,
        },
      });
      await publishEvent(t, {
        type: 'integration.account_linked',
        aggregateType: 'member',
        aggregateId: actor.memberId,
        subjectMemberId: actor.memberId,
        payload: { provider: PROVIDER, username: data.username },
      });
      return toView(row!);
    });
  } catch (error) {
    if (isUniqueViolation(error, 'external_accounts_username_uq')) throw takenError();
    // A concurrent link by the same member won the race.
    if (isUniqueViolation(error))
      throw new ConflictError('Your link changed meanwhile. Try again.');
    throw error;
  }
}

export async function unlinkGithubAccount(
  ctx: ServiceContext,
  input: z.input<typeof unlinkGithubAccountSchema>,
): Promise<void> {
  const data = parseInput(unlinkGithubAccountSchema, input);
  const actor = requireActiveMember(ctx);
  const memberId = data.memberId ?? actor.memberId;
  if (!isSelf(ctx.actor, memberId)) {
    await authorize(ctx, 'canVerifyMembers', { type: 'member', id: memberId });
  }
  const account = await findAccount(ctx, memberId);
  if (!account) throw new NotFoundError('Linked GitHub account');
  await withTransaction(ctx, async (t) => {
    await t.db.delete(externalAccounts).where(eq(externalAccounts.id, account.id));
    await recordAudit(t, {
      action: 'external_account.unlinked',
      targetType: 'member',
      targetId: memberId,
      context: { provider: PROVIDER, username: account.username },
    });
  });
}

/**
 * Staff mark a linked GitHub account verified (or revoke verification).
 * Verified accounts turn pull requests that someone else merged into
 * verified contributions, so nobody may verify their own account, and
 * verifying binds GitHub's numeric user id.
 */
export async function setExternalAccountVerification(
  ctx: ServiceContext,
  input: z.input<typeof setExternalAccountVerificationSchema>,
): Promise<ExternalAccountView> {
  const data = parseInput(setExternalAccountVerificationSchema, input);
  await authorize(ctx, 'canVerifyMembers', { type: 'member', id: data.memberId });
  if (isSelf(ctx.actor, data.memberId)) {
    await recordAudit(
      ctx,
      {
        action: 'external_account.self_verification_blocked',
        targetType: 'member',
        targetId: data.memberId,
        result: 'denied',
      },
      { durable: true },
    );
    throw new ForbiddenError('You cannot verify your own linked account.');
  }
  const account = await findAccount(ctx, data.memberId);
  if (!account) throw new NotFoundError('Linked GitHub account');
  const externalId = data.externalId ?? account.externalId;
  if (data.verified && externalId === null) {
    throw new ValidationError(
      'Add the numeric GitHub user id to verify this account: pull requests are matched by id.',
      [{ path: 'externalId', message: 'required to verify' }],
    );
  }
  try {
    return await withTransaction(ctx, async (t) => {
      const now = t.clock.now();
      const [row] = await t.db
        .update(externalAccounts)
        .set({
          verifiedAt: data.verified ? now : null,
          verifiedByUserId: data.verified && t.actor.kind === 'user' ? t.actor.userId : null,
          externalId,
          updatedAt: now,
        })
        .where(eq(externalAccounts.id, account.id))
        .returning();
      await recordAudit(t, {
        action: data.verified ? 'external_account.verified' : 'external_account.unverified',
        targetType: 'member',
        targetId: data.memberId,
        context: { provider: PROVIDER, username: account.username, externalId: row!.externalId },
      });
      await publishEvent(t, {
        type: 'integration.account_verified',
        aggregateType: 'member',
        aggregateId: data.memberId,
        subjectMemberId: data.memberId,
        payload: { provider: PROVIDER, verified: data.verified },
      });
      const [owner] = await t.db
        .select({ userId: members.userId })
        .from(members)
        .where(eq(members.id, data.memberId));
      if (owner) {
        await notify(t, {
          recipientUserId: owner.userId,
          type: 'verification.completed',
          title: data.verified ? 'GITHUB VERIFIED' : 'GITHUB VERIFICATION REVOKED',
          body: data.verified
            ? `${account.username} — linked account verified. Pull requests merged by someone else now count as verified contributions.`
            : `${account.username} — verification revoked.`,
          dedupeKey: `external-account:${account.id}:${data.verified ? 'verified' : 'revoked'}:${now.getTime()}`,
        });
      }
      return toView(row!);
    });
  } catch (error) {
    if (isUniqueViolation(error, 'external_accounts_external_id_uq')) throw takenError();
    throw error;
  }
}

/** Your own linked accounts, or anyone's for staff who may view private profiles. */
export async function getExternalAccounts(
  ctx: ServiceContext,
  input: { memberId: string },
): Promise<ExternalAccountView[]> {
  const data = parseInput(z.object({ memberId: z.uuid() }), input);
  if (!isSelf(ctx.actor, data.memberId) && !can(ctx, 'canViewPrivateProfiles')) {
    await authorize(ctx, 'canVerifyMembers', { type: 'member', id: data.memberId });
  }
  const account = await findAccount(ctx, data.memberId);
  return account ? [toView(account)] : [];
}

/**
 * Resolve a GitHub author to a linked account (system actor only). A match
 * on the numeric id wins; a login match only counts while the account has no
 * bound id, so a renamed-and-reclaimed login never inherits someone's identity.
 */
export async function findGithubAccount(
  ctx: ServiceContext,
  author: { login: string; id: number },
): Promise<ExternalAccountRecord | null> {
  if (ctx.actor.kind !== 'system') throw new ForbiddenError();
  const login = author.login.toLowerCase();
  const externalId = String(author.id);
  const rows = await ctx.db
    .select()
    .from(externalAccounts)
    .where(
      and(
        eq(externalAccounts.provider, PROVIDER),
        or(eq(externalAccounts.externalId, externalId), eq(externalAccounts.username, login)),
      ),
    );
  const byId = rows.find((row) => row.externalId === externalId);
  if (byId) return byId;
  return rows.find((row) => row.username === login && row.externalId === null) ?? null;
}
