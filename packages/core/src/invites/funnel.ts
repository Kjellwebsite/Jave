import { and, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { inviteCodes, referrals } from '@jave/database';
import type { ServiceContext } from '../kernel/context';

/**
 * INVITED → JOINED → RETAINED → VALID, plus the exits.
 *
 * - invited: Discord invite uses on the scope's invites + referral-code claims
 *   (invite uses are cumulative and include uses before a campaign was attached)
 * - joined: attributed joins
 * - retained: joins that reached RETAINED (including those later VALID or LEFT)
 * - valid: VALID referrals (flagged ones included; the leaderboard excludes them)
 */
export interface ReferralFunnel {
  invited: number;
  inviteUses: number;
  codeClaims: number;
  joined: number;
  retained: number;
  valid: number;
  left: number;
  invalid: number;
  /** Carrying anomaly flags and not invalid: awaiting review. */
  flagged: number;
  fastLeaves: number;
  /** retained / joined */
  retentionRate: number | null;
  /** valid / joined */
  validRate: number | null;
}

const RATE_PRECISION = 10_000;

export function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * RATE_PRECISION) / RATE_PRECISION;
}

export function emptyFunnel(): ReferralFunnel {
  return buildFunnel(undefined, 0);
}

interface ReferralCounts {
  joined: number;
  retained: number;
  valid: number;
  left: number;
  invalid: number;
  flagged: number;
  fastLeaves: number;
  codeClaims: number;
}

function buildFunnel(counts: ReferralCounts | undefined, inviteUses: number): ReferralFunnel {
  const c = counts ?? {
    joined: 0,
    retained: 0,
    valid: 0,
    left: 0,
    invalid: 0,
    flagged: 0,
    fastLeaves: 0,
    codeClaims: 0,
  };
  return {
    invited: inviteUses + c.codeClaims,
    inviteUses,
    codeClaims: c.codeClaims,
    joined: c.joined,
    retained: c.retained,
    valid: c.valid,
    left: c.left,
    invalid: c.invalid,
    flagged: c.flagged,
    fastLeaves: c.fastLeaves,
    retentionRate: ratio(c.retained, c.joined),
    validRate: ratio(c.valid, c.joined),
  };
}

/** Aggregate columns over `referrals`, shared by every funnel query. */
export const referralCountColumns = {
  joined: sql<number>`count(*)::int`,
  retained: sql<number>`count(*) filter (where ${referrals.retainedAt} is not null)::int`,
  valid: sql<number>`count(*) filter (where ${referrals.status} = 'valid')::int`,
  left: sql<number>`count(*) filter (where ${referrals.status} = 'left')::int`,
  invalid: sql<number>`count(*) filter (where ${referrals.status} = 'invalid')::int`,
  flagged: sql<number>`count(*) filter (where cardinality(${referrals.anomalyFlags}) > 0 and ${referrals.status} <> 'invalid')::int`,
  fastLeaves: sql<number>`count(*) filter (where 'fast_leave' = any(${referrals.anomalyFlags}))::int`,
  codeClaims: sql<number>`count(*) filter (where ${referrals.method} = 'referral_code')::int`,
};

export type FunnelScope =
  | { groupBy: 'campaign'; campaignIds: readonly string[] }
  | { groupBy: 'inviter'; inviterUserIds: readonly string[]; campaignId?: string | null };

/** Funnels for a set of campaigns or inviters, keyed by id. Two queries total. */
export async function loadFunnels(
  ctx: ServiceContext,
  scope: FunnelScope,
): Promise<Map<string, ReferralFunnel>> {
  const byCampaign = scope.groupBy === 'campaign';
  const keys = [...new Set(byCampaign ? scope.campaignIds : scope.inviterUserIds)];
  if (keys.length === 0) return new Map();
  const referralKey = byCampaign ? referrals.campaignId : referrals.inviterUserId;
  const inviteKey = byCampaign ? inviteCodes.campaignId : inviteCodes.inviterUserId;
  const referralFilters: SQL[] = [inArray(referralKey, keys)];
  const inviteFilters: SQL[] = [inArray(inviteKey, keys)];
  if (!byCampaign && scope.campaignId) {
    referralFilters.push(eq(referrals.campaignId, scope.campaignId));
    inviteFilters.push(eq(inviteCodes.campaignId, scope.campaignId));
  }
  const [referralRows, inviteRows] = await Promise.all([
    ctx.db
      .select({ key: referralKey, ...referralCountColumns })
      .from(referrals)
      .where(and(...referralFilters))
      .groupBy(referralKey),
    ctx.db
      .select({ key: inviteKey, uses: sql<number>`coalesce(sum(${inviteCodes.uses}), 0)::int` })
      .from(inviteCodes)
      .where(and(...inviteFilters))
      .groupBy(inviteKey),
  ]);
  const counts = new Map(referralRows.map((row) => [row.key, row]));
  const uses = new Map(inviteRows.map((row) => [row.key, row.uses]));
  return new Map(keys.map((key) => [key, buildFunnel(counts.get(key), uses.get(key) ?? 0)]));
}

/** Server-wide funnel: every referral and every mirrored invite (vanity included). */
export async function loadGlobalFunnel(ctx: ServiceContext): Promise<ReferralFunnel> {
  const [[counts], [invites]] = await Promise.all([
    ctx.db.select(referralCountColumns).from(referrals),
    ctx.db
      .select({ uses: sql<number>`coalesce(sum(${inviteCodes.uses}), 0)::int` })
      .from(inviteCodes),
  ]);
  return buildFunnel(counts, invites?.uses ?? 0);
}
