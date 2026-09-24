import { and, eq, isNull } from 'drizzle-orm';
import { members, type researchStatus, researchItems } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { ForbiddenError, InvalidStateError, NotFoundError } from '../kernel/errors';
import type { UserActor } from '../permissions/actor';
import { authorize, can, requireMember } from '../permissions/authorize';

export type ResearchItemRecord = typeof researchItems.$inferSelect;
export type ResearchStatus = (typeof researchStatus.enumValues)[number];

/** A research item as services return it (soft-delete bookkeeping omitted). */
export type ResearchItemView = Omit<ResearchItemRecord, 'deletedAt'>;

export function toView(row: ResearchItemRecord): ResearchItemView {
  const { deletedAt: _deletedAt, ...view } = row;
  return view;
}

export const STATUS_LABELS: Readonly<Record<ResearchStatus, string>> = {
  new: 'NEW',
  needs_review: 'NEEDS REVIEW',
  reviewed: 'REVIEWED',
  verified: 'VERIFIED',
  archived: 'ARCHIVED',
};

/**
 * NEW → NEEDS REVIEW → REVIEWED → VERIFIED → ARCHIVED, with reviewers able to
 * step back (e.g. VERIFIED → REVIEWED) and restore ARCHIVED → NEEDS REVIEW.
 */
const TRANSITIONS: Readonly<Record<ResearchStatus, readonly ResearchStatus[]>> = {
  new: ['needs_review', 'reviewed', 'verified', 'archived'],
  needs_review: ['reviewed', 'verified', 'archived'],
  reviewed: ['needs_review', 'verified', 'archived'],
  verified: ['needs_review', 'reviewed', 'archived'],
  archived: ['needs_review'],
};

export function canTransition(from: ResearchStatus, to: ResearchStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ResearchStatus, to: ResearchStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidStateError(
      `A ${STATUS_LABELS[from]} item cannot move to ${STATUS_LABELS[to]}.`,
      { from, to },
    );
  }
}

/** Load a live (not soft-deleted) item, optionally locking it for update. */
export async function loadItem(
  ctx: ServiceContext,
  itemId: string,
  options: { forUpdate?: boolean } = {},
): Promise<ResearchItemRecord> {
  const query = ctx.db
    .select()
    .from(researchItems)
    .where(and(eq(researchItems.id, itemId), isNull(researchItems.deletedAt)));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  if (!row) throw new NotFoundError('Research item');
  return row;
}

/**
 * Who may add to the library: members in good standing who can see the
 * member directory. Restricted, quarantined and banned members cannot.
 */
export async function requireContributor(
  ctx: ServiceContext,
): Promise<UserActor & { memberId: string }> {
  const actor = requireMember(ctx);
  await authorize(ctx, 'canViewMembers', { type: 'research_item' });
  if (actor.standing !== 'good') {
    throw new ForbiddenError('Your account cannot add research right now.');
  }
  return actor;
}

export function isSubmitter(ctx: Pick<ServiceContext, 'actor'>, item: ResearchItemRecord): boolean {
  return ctx.actor.kind === 'user' && ctx.actor.userId === item.submittedByUserId;
}

export function isReviewer(ctx: Pick<ServiceContext, 'actor'>): boolean {
  return can(ctx, 'canReviewResearch');
}

/** Archived items stay visible to their submitter and to reviewers only. */
export function canSee(ctx: Pick<ServiceContext, 'actor'>, item: ResearchItemRecord): boolean {
  return item.status !== 'archived' || isSubmitter(ctx, item) || isReviewer(ctx);
}

export async function memberIdForUser(ctx: ServiceContext, userId: string): Promise<string | null> {
  const [row] = await ctx.db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.userId, userId));
  return row?.id ?? null;
}
