import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  ne,
  type SQL,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { members, referralCodes, referrals } from '@jave/database';
import { DAY } from '../kernel/clock';
import type { ServiceContext } from '../kernel/context';
import { NotFoundError } from '../kernel/errors';
import { type Page, pageSchema } from '../kernel/pagination';
import { parseInput } from '../kernel/validation';
import { authorize, isSelf, requireMember } from '../permissions/authorize';
import {
  LEADERBOARD_DEFAULT_LIMIT,
  LEADERBOARD_MAX_LIMIT,
  MY_REFERRALS_LIMIT,
  PRIVATE_MEMBER_LABEL,
} from './constants';
import { emptyFunnel, loadFunnels, loadGlobalFunnel, type ReferralFunnel } from './funnel';
import type { ReferralStatus } from './lifecycle';

const LEADERBOARD_PERIOD_DAYS = [7, 30, 90] as const;
const periodDays = z.literal(LEADERBOARD_PERIOD_DAYS);
const REFERRAL_STATUSES = ['joined', 'retained', 'valid', 'left', 'invalid'] as const;

/** Never flagged, or cleared by staff review. */
const isClean = sql`cardinality(${referrals.anomalyFlags}) = 0`;
const isFlagged = sql`cardinality(${referrals.anomalyFlags}) > 0`;

// ─── Leaderboard ─────────────────────────────────────────────────────────────

export const leaderboardSchema = z.object({
  campaignId: z.uuid().optional(),
  /** Count referrals validated in the last N days; omit for all time. */
  periodDays: periodDays.optional(),
  limit: z.number().int().min(1).max(LEADERBOARD_MAX_LIMIT).default(LEADERBOARD_DEFAULT_LIMIT),
});

export interface LeaderboardEntry {
  rank: number;
  memberId: string;
  handle: string;
  displayName: string;
  validReferrals: number;
}

/**
 * Referral leaderboard. Counts only VALID, unflagged referrals; inviters who
 * opted out (showOnLeaderboards = false), keep a staff-only profile, are not
 * in good standing, or were deleted never appear. Ties share a rank.
 */
export async function getReferralLeaderboard(
  ctx: ServiceContext,
  input: z.input<typeof leaderboardSchema> = {},
): Promise<LeaderboardEntry[]> {
  const q = parseInput(leaderboardSchema, input);
  await authorize(ctx, 'canViewMembers', { type: 'leaderboard' });
  const filters: SQL[] = [eq(referrals.status, 'valid'), isClean];
  if (q.campaignId) filters.push(eq(referrals.campaignId, q.campaignId));
  if (q.periodDays) {
    const since = new Date(ctx.clock.now().getTime() - q.periodDays * DAY);
    filters.push(gte(referrals.validatedAt, since));
  }
  const validCount = count();
  const rows = await ctx.db
    .select({
      memberId: members.id,
      handle: members.handle,
      displayName: members.displayName,
      validReferrals: validCount,
    })
    .from(referrals)
    .innerJoin(
      members,
      and(
        eq(members.userId, referrals.inviterUserId),
        isNull(members.deletedAt),
        eq(members.showOnLeaderboards, true),
        ne(members.profileVisibility, 'staff'),
        eq(members.standing, 'good'),
      ),
    )
    .where(and(...filters))
    .groupBy(members.id, members.handle, members.displayName)
    .orderBy(desc(validCount), asc(sql`max(${referrals.validatedAt})`), asc(members.handle))
    .limit(q.limit);
  let rank = 0;
  let previous: number | null = null;
  return rows.map((row, index) => {
    if (row.validReferrals !== previous) rank = index + 1;
    previous = row.validReferrals;
    return { rank, ...row };
  });
}

// ─── Funnels ─────────────────────────────────────────────────────────────────

export const funnelQuerySchema = z.object({
  inviterMemberId: z.uuid().optional(),
  campaignId: z.uuid().optional(),
});

async function memberUserId(ctx: ServiceContext, memberId: string): Promise<string> {
  const [row] = await ctx.db
    .select({ userId: members.userId })
    .from(members)
    .where(and(eq(members.id, memberId), isNull(members.deletedAt)));
  if (!row) throw new NotFoundError('Member');
  return row.userId;
}

/**
 * INVITED → JOINED → RETAINED → VALID for one inviter (members may read their
 * own), one campaign, or the whole server (staff: canViewAnalytics).
 */
export async function getReferralFunnel(
  ctx: ServiceContext,
  input: z.input<typeof funnelQuerySchema> = {},
): Promise<ReferralFunnel> {
  const q = parseInput(funnelQuerySchema, input);
  const ownFunnel = q.inviterMemberId !== undefined && isSelf(ctx.actor, q.inviterMemberId);
  if (!ownFunnel) {
    await authorize(ctx, 'canViewAnalytics', {
      type: q.inviterMemberId ? 'member' : 'campaign',
      id: q.inviterMemberId ?? q.campaignId ?? null,
    });
  }
  if (q.inviterMemberId) {
    const userId = await memberUserId(ctx, q.inviterMemberId);
    const funnels = await loadFunnels(ctx, {
      groupBy: 'inviter',
      inviterUserIds: [userId],
      campaignId: q.campaignId ?? null,
    });
    return funnels.get(userId) ?? emptyFunnel();
  }
  if (q.campaignId) {
    const funnels = await loadFunnels(ctx, { groupBy: 'campaign', campaignIds: [q.campaignId] });
    return funnels.get(q.campaignId) ?? emptyFunnel();
  }
  return loadGlobalFunnel(ctx);
}

export const inviterFunnelsSchema = pageSchema.extend({ campaignId: z.uuid().optional() });

export interface InviterFunnelRow {
  inviterUserId: string;
  memberId: string | null;
  handle: string | null;
  displayName: string | null;
  funnel: ReferralFunnel;
}

/** Staff table: inviters with at least one attributed join, best first. */
export async function listInviterFunnels(
  ctx: ServiceContext,
  input: z.input<typeof inviterFunnelsSchema> = {},
): Promise<Page<InviterFunnelRow>> {
  const q = parseInput(inviterFunnelsSchema, input);
  await authorize(ctx, 'canViewAnalytics', { type: 'referral' });
  const filters: SQL[] = [isNotNull(referrals.inviterUserId)];
  if (q.campaignId) filters.push(eq(referrals.campaignId, q.campaignId));
  const where = and(...filters);
  const valid = sql<number>`count(*) filter (where ${referrals.status} = 'valid')::int`;
  const joined = count();
  const [rows, [total]] = await Promise.all([
    ctx.db
      .select({
        inviterUserId: sql<string>`${referrals.inviterUserId}`,
        memberId: members.id,
        handle: members.handle,
        displayName: members.displayName,
      })
      .from(referrals)
      .leftJoin(members, eq(members.userId, referrals.inviterUserId))
      .where(where)
      .groupBy(referrals.inviterUserId, members.id, members.handle, members.displayName)
      .orderBy(desc(valid), desc(joined), asc(referrals.inviterUserId))
      .limit(q.limit)
      .offset(q.offset),
    ctx.db
      .select({ value: countDistinct(referrals.inviterUserId) })
      .from(referrals)
      .where(where),
  ]);
  const funnels = await loadFunnels(ctx, {
    groupBy: 'inviter',
    inviterUserIds: rows.map((r) => r.inviterUserId),
    campaignId: q.campaignId ?? null,
  });
  return {
    items: rows.map((row) => ({
      ...row,
      funnel: funnels.get(row.inviterUserId) ?? emptyFunnel(),
    })),
    total: total?.value ?? 0,
    limit: q.limit,
    offset: q.offset,
  };
}

// ─── Member view ─────────────────────────────────────────────────────────────

export interface MyReferralCode {
  code: string;
  campaignId: string | null;
  active: boolean;
  claims: number;
  createdAt: Date;
}

export interface MyReferral {
  id: string;
  inviteeName: string;
  method: string;
  status: ReferralStatus;
  joinedAt: Date;
  retainedAt: Date | null;
  validatedAt: Date | null;
  leftAt: Date | null;
  /** Held for staff review. Flag details are never shown to the inviter. */
  underReview: boolean;
}

export interface MyReferralsView {
  codes: MyReferralCode[];
  funnel: ReferralFunnel;
  referrals: MyReferral[];
  showOnLeaderboards: boolean;
  /** The referral code this member used, if any. */
  usedCode: string | null;
}

/** The caller's codes, funnel and recent referrals. Invitee privacy is respected. */
export async function getMyReferrals(ctx: ServiceContext): Promise<MyReferralsView> {
  const actor = requireMember(ctx);
  const invitee = alias(members, 'invitee');
  const claims = sql<number>`(select count(*)::int from ${referrals} where ${referrals.referralCode} = ${referralCodes.code})`;
  const [codes, funnels, recent, [self], [used]] = await Promise.all([
    ctx.db
      .select({
        code: referralCodes.code,
        campaignId: referralCodes.campaignId,
        active: referralCodes.active,
        claims,
        createdAt: referralCodes.createdAt,
      })
      .from(referralCodes)
      .where(eq(referralCodes.ownerUserId, actor.userId))
      .orderBy(desc(referralCodes.active), desc(referralCodes.createdAt)),
    loadFunnels(ctx, { groupBy: 'inviter', inviterUserIds: [actor.userId] }),
    ctx.db
      .select({
        id: referrals.id,
        displayName: invitee.displayName,
        visibility: invitee.profileVisibility,
        method: referrals.method,
        status: referrals.status,
        joinedAt: referrals.joinedAt,
        retainedAt: referrals.retainedAt,
        validatedAt: referrals.validatedAt,
        leftAt: referrals.leftAt,
        flagged: sql<boolean>`${isFlagged}`,
      })
      .from(referrals)
      .leftJoin(invitee, eq(invitee.userId, referrals.inviteeUserId))
      .where(eq(referrals.inviterUserId, actor.userId))
      .orderBy(desc(referrals.joinedAt))
      .limit(MY_REFERRALS_LIMIT),
    ctx.db
      .select({ showOnLeaderboards: members.showOnLeaderboards })
      .from(members)
      .where(eq(members.id, actor.memberId)),
    ctx.db
      .select({ code: referrals.referralCode })
      .from(referrals)
      .where(and(eq(referrals.inviteeUserId, actor.userId), isNotNull(referrals.referralCode)))
      .limit(1),
  ]);
  return {
    codes,
    funnel: funnels.get(actor.userId) ?? emptyFunnel(),
    referrals: recent.map((row) => ({
      id: row.id,
      inviteeName:
        row.displayName && row.visibility !== 'staff' ? row.displayName : PRIVATE_MEMBER_LABEL,
      method: row.method,
      status: row.status,
      joinedAt: row.joinedAt,
      retainedAt: row.retainedAt,
      validatedAt: row.validatedAt,
      leftAt: row.leftAt,
      underReview: row.flagged && row.status !== 'invalid',
    })),
    showOnLeaderboards: self?.showOnLeaderboards ?? true,
    usedCode: used?.code ?? null,
  };
}

// ─── Staff listing ───────────────────────────────────────────────────────────

export const listReferralsSchema = pageSchema.extend({
  status: z.enum(REFERRAL_STATUSES).optional(),
  /** Only referrals carrying anomaly flags (the review queue). */
  flagged: z.boolean().optional(),
  inviterMemberId: z.uuid().optional(),
  campaignId: z.uuid().optional(),
});

export interface ReferralListItem {
  id: string;
  method: string;
  status: ReferralStatus;
  statusReason: string | null;
  inviteCode: string | null;
  referralCode: string | null;
  campaignId: string | null;
  inviterUserId: string | null;
  inviterName: string | null;
  inviteeUserId: string;
  inviteeName: string | null;
  anomalyFlags: string[];
  anomalyScore: number;
  joinedAt: Date;
  retainedAt: Date | null;
  validatedAt: Date | null;
  leftAt: Date | null;
  reviewedAt: Date | null;
}

/** Staff listing with anomaly detail (canViewAnalytics). */
export async function listReferrals(
  ctx: ServiceContext,
  input: z.input<typeof listReferralsSchema> = {},
): Promise<Page<ReferralListItem>> {
  const q = parseInput(listReferralsSchema, input);
  await authorize(ctx, 'canViewAnalytics', { type: 'referral' });
  const inviter = alias(members, 'inviter');
  const invitee = alias(members, 'invitee');
  const filters: SQL[] = [];
  if (q.status) filters.push(eq(referrals.status, q.status));
  if (q.flagged !== undefined) filters.push(q.flagged ? isFlagged : isClean);
  if (q.campaignId) filters.push(eq(referrals.campaignId, q.campaignId));
  if (q.inviterMemberId) {
    filters.push(eq(referrals.inviterUserId, await memberUserId(ctx, q.inviterMemberId)));
  }
  const where = filters.length > 0 ? and(...filters) : undefined;
  const [rows, [total]] = await Promise.all([
    ctx.db
      .select({
        id: referrals.id,
        method: referrals.method,
        status: referrals.status,
        statusReason: referrals.statusReason,
        inviteCode: referrals.inviteCode,
        referralCode: referrals.referralCode,
        campaignId: referrals.campaignId,
        inviterUserId: referrals.inviterUserId,
        inviterName: inviter.displayName,
        inviteeUserId: referrals.inviteeUserId,
        inviteeName: invitee.displayName,
        anomalyFlags: referrals.anomalyFlags,
        anomalyScore: referrals.anomalyScore,
        joinedAt: referrals.joinedAt,
        retainedAt: referrals.retainedAt,
        validatedAt: referrals.validatedAt,
        leftAt: referrals.leftAt,
        reviewedAt: referrals.reviewedAt,
      })
      .from(referrals)
      .leftJoin(inviter, eq(inviter.userId, referrals.inviterUserId))
      .leftJoin(invitee, eq(invitee.userId, referrals.inviteeUserId))
      .where(where)
      .orderBy(desc(referrals.anomalyScore), desc(referrals.joinedAt), asc(referrals.id))
      .limit(q.limit)
      .offset(q.offset),
    ctx.db.select({ value: count() }).from(referrals).where(where),
  ]);
  return { items: rows, total: total?.value ?? 0, limit: q.limit, offset: q.offset };
}
