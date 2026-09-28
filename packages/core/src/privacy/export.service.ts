import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { members, users } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import type { ServiceContext } from '../kernel/context';
import { NotFoundError, ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { authorize, requireUser } from '../permissions/authorize';
import { consumeRateLimit } from '../rate-limit/rate-limit';
import {
  EXPORT_FORMAT,
  EXPORT_RATE_LIMIT,
  EXPORT_RATE_WINDOW_SECONDS,
  EXPORT_VERSION,
  MAX_REASON_LENGTH,
} from './constants';
import {
  accountSection,
  aiSection,
  applicationsSection,
  capabilitySection,
  communitySection,
  moderationSection,
  notificationsSection,
  rolesSection,
  type Subject,
  supportSection,
  trialsSection,
  withheldCounts,
  workSection,
} from './export-sections';

export const exportMemberDataSchema = z.object({
  /** Omit for your own data. */
  memberId: z.uuid().optional(),
  /** Required when a founder exports someone else's data (a data-subject request). */
  reason: z.string().trim().max(MAX_REASON_LENGTH).optional(),
});

/** Why each withheld category is not in the export. Counts come with it. */
export const WITHHELD_REASONS = {
  applicationReviews: 'Reviewers’ assessments of your applications.',
  staffNotes: 'Private notes staff keep about members.',
  evaluatorNotes: 'Evaluators’ notes on your capability ranks.',
  trialEvaluations: 'Evaluators’ scores and notes from trials (published results are included).',
  moderationNotes: 'Private moderation notes (actions taken on you are included).',
  securityEvents: 'Automated security signals and their evidence.',
  auditEntries:
    'Audit log entries about your account (the organization’s record of staff actions).',
} as const;

export interface WithheldCategory {
  category: keyof typeof WITHHELD_REASONS;
  count: number;
  reason: string;
}

export interface MemberExport {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  generatedAt: string;
  subject: { userId: string; discordId: string; memberId: string | null; handle: string | null };
  sections: {
    account: Awaited<ReturnType<typeof accountSection>>;
    roles: Awaited<ReturnType<typeof rolesSection>>;
    capability: Awaited<ReturnType<typeof capabilitySection>> | null;
    applications: Awaited<ReturnType<typeof applicationsSection>>;
    trials: Awaited<ReturnType<typeof trialsSection>> | null;
    work: Awaited<ReturnType<typeof workSection>> | null;
    community: Awaited<ReturnType<typeof communitySection>>;
    support: Awaited<ReturnType<typeof supportSection>>;
    moderation: Awaited<ReturnType<typeof moderationSection>>;
    notifications: Awaited<ReturnType<typeof notificationsSection>>;
    ai: Awaited<ReturnType<typeof aiSection>>;
  };
  /**
   * What staff hold about you that this file does not contain, and why. A
   * founder can answer a request for it.
   */
  withheld: WithheldCategory[];
}

/**
 * A copy of a member's data, as a JSON-serializable document.
 *
 * - Your own: any signed-in account.
 * - Someone else's: `canManagePrivacy` (founders), with a reason — for a
 *   verified data-subject request.
 *
 * Rate-limited per requester and audited `privacy.exported`.
 */
export async function exportMemberData(
  ctx: ServiceContext,
  input: z.input<typeof exportMemberDataSchema> = {},
): Promise<MemberExport> {
  const data = parseInput(exportMemberDataSchema, input);
  const actor = requireUser(ctx);
  const self = !data.memberId || data.memberId === actor.memberId;
  if (!self) {
    await authorize(ctx, 'canManagePrivacy', { type: 'member', id: data.memberId });
    if (!data.reason) {
      throw new ValidationError('Give a reason.', [{ path: 'reason', message: 'Required.' }]);
    }
  }
  const subject = self
    ? { userId: actor.userId, memberId: actor.memberId }
    : await loadSubject(ctx, data.memberId!);
  await consumeRateLimit(
    ctx,
    `privacy:export:${actor.userId}`,
    EXPORT_RATE_LIMIT,
    EXPORT_RATE_WINDOW_SECONDS,
  );

  const document = await buildExport(ctx, subject);
  await recordAudit(
    ctx,
    {
      action: 'privacy.exported',
      targetType: 'user',
      targetId: subject.userId,
      context: { self, ...(data.reason && { reason: data.reason }) },
    },
    { durable: true },
  );
  return document;
}

async function loadSubject(ctx: ServiceContext, memberId: string): Promise<Subject> {
  const [row] = await ctx.db
    .select({ userId: members.userId, memberId: members.id })
    .from(members)
    .where(eq(members.id, memberId));
  if (!row) throw new NotFoundError('Member');
  return row;
}

async function buildExport(ctx: ServiceContext, subject: Subject): Promise<MemberExport> {
  const db = ctx.db;
  const [identity] = await db
    .select({ discordId: users.discordId, handle: members.handle })
    .from(users)
    .leftJoin(members, eq(members.userId, users.id))
    .where(eq(users.id, subject.userId));
  if (!identity) throw new NotFoundError('User');
  const memberId = subject.memberId;
  const withheld = await withheldCounts(db, subject);
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    generatedAt: ctx.clock.now().toISOString(),
    subject: {
      userId: subject.userId,
      discordId: identity.discordId,
      memberId,
      handle: identity.handle,
    },
    sections: {
      account: await accountSection(db, subject),
      roles: memberId ? await rolesSection(db, memberId) : [],
      capability: memberId ? await capabilitySection(db, memberId) : null,
      applications: await applicationsSection(db, subject.userId),
      trials: memberId ? await trialsSection(db, memberId) : null,
      work: memberId ? await workSection(db, memberId) : null,
      community: await communitySection(db, subject),
      support: await supportSection(db, subject.userId),
      moderation: await moderationSection(db, subject.userId),
      notifications: await notificationsSection(db, subject.userId),
      ai: await aiSection(db, subject.userId),
    },
    withheld: (Object.keys(WITHHELD_REASONS) as (keyof typeof WITHHELD_REASONS)[])
      .map((category) => ({
        category,
        count: withheld[category],
        reason: WITHHELD_REASONS[category],
      }))
      .filter((entry) => entry.count > 0),
  };
}

/** `jave-export-<handle>-<YYYY-MM-DD>.json`, safe as a download file name. */
export function exportFileName(document: Pick<MemberExport, 'subject' | 'generatedAt'>): string {
  const handle = (document.subject.handle ?? 'account').replace(/[^a-z0-9-]/gi, '');
  return `jave-export-${handle || 'account'}-${document.generatedAt.slice(0, 10)}.json`;
}
