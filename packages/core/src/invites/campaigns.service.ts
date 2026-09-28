import { and, asc, count, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { campaigns, inviteCodes, referralCodes, referrals } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ConflictError, isUniqueViolation, NotFoundError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { actorUserId } from '../permissions/actor';
import { authorize } from '../permissions/authorize';
import { emptyFunnel, type ReferralFunnel, loadFunnels } from './funnel';

export type CampaignRecord = typeof campaigns.$inferSelect;

const CAMPAIGN_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{1,47}$/;

const campaignKey = z
  .string()
  .trim()
  .toLowerCase()
  .regex(CAMPAIGN_KEY_PATTERN, 'use 2–48 lowercase letters, digits or dashes');
const campaignName = z.string().trim().min(2).max(120);
const campaignDescription = z.string().trim().max(2000);

function windowIsOrdered(value: { startsAt?: Date | null; endsAt?: Date | null }): boolean {
  return !value.startsAt || !value.endsAt || value.endsAt.getTime() > value.startsAt.getTime();
}
const WINDOW_ORDER_ERROR = { message: 'endsAt must be after startsAt', path: ['endsAt'] };

export const createCampaignSchema = z
  .object({
    key: campaignKey,
    name: campaignName,
    description: campaignDescription.optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    active: z.boolean().default(true),
  })
  .refine(windowIsOrdered, WINDOW_ORDER_ERROR);

export const updateCampaignSchema = z.object({
  campaignId: z.uuid(),
  name: campaignName.optional(),
  description: campaignDescription.nullable().optional(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  active: z.boolean().optional(),
});

export const attachInviteSchema = z.object({
  code: z.string().trim().min(2).max(32),
  /** Null detaches the invite from any campaign. */
  campaignId: z.uuid().nullable(),
});

export const detachInviteSchema = z.object({
  code: z.string().trim().min(2).max(32),
  /** The campaign the invite must be attached to right now. */
  campaignId: z.uuid(),
});

/** Does a campaign accept attributions at `at`? (active and inside its window) */
export function campaignAccepts(
  campaign: Pick<CampaignRecord, 'active' | 'startsAt' | 'endsAt'>,
  at: Date,
): boolean {
  if (!campaign.active) return false;
  if (campaign.startsAt && at.getTime() < campaign.startsAt.getTime()) return false;
  if (campaign.endsAt && at.getTime() >= campaign.endsAt.getTime()) return false;
  return true;
}

export async function loadCampaign(ctx: ServiceContext, campaignId: string) {
  const [row] = await ctx.db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!row) throw new NotFoundError('Campaign');
  return row;
}

export async function createCampaign(
  ctx: ServiceContext,
  input: z.input<typeof createCampaignSchema>,
): Promise<CampaignRecord> {
  const data = parseInput(createCampaignSchema, input);
  await authorize(ctx, 'canManageCampaigns', { type: 'campaign' });
  try {
    return await withTransaction(ctx, async (tx) => {
      const now = tx.clock.now();
      const [row] = await tx.db
        .insert(campaigns)
        .values({
          key: data.key,
          name: data.name,
          description: data.description || null,
          startsAt: data.startsAt ?? null,
          endsAt: data.endsAt ?? null,
          active: data.active,
          createdByUserId: actorUserId(tx.actor),
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await recordAudit(tx, {
        action: 'campaign.created',
        targetType: 'campaign',
        targetId: row!.id,
        context: { key: data.key, name: data.name },
      });
      return row!;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError('A campaign with that key exists.');
    throw error;
  }
}

export async function updateCampaign(
  ctx: ServiceContext,
  input: z.input<typeof updateCampaignSchema>,
): Promise<CampaignRecord> {
  const data = parseInput(updateCampaignSchema, input);
  await authorize(ctx, 'canManageCampaigns', { type: 'campaign', id: data.campaignId });
  const current = await loadCampaign(ctx, data.campaignId);
  const next = {
    name: data.name ?? current.name,
    description: data.description === undefined ? current.description : data.description || null,
    startsAt: data.startsAt === undefined ? current.startsAt : data.startsAt,
    endsAt: data.endsAt === undefined ? current.endsAt : data.endsAt,
    active: data.active ?? current.active,
  };
  parseInput(
    z
      .object({ startsAt: z.date().nullable(), endsAt: z.date().nullable() })
      .refine(windowIsOrdered, WINDOW_ORDER_ERROR),
    { startsAt: next.startsAt, endsAt: next.endsAt },
  );
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(next) as (keyof typeof next)[]) {
    const from = current[key];
    const to = next[key];
    const same =
      from instanceof Date || to instanceof Date
        ? (from as Date | null)?.getTime() === (to as Date | null)?.getTime()
        : from === to;
    if (!same) changes[key] = { from, to };
  }
  if (Object.keys(changes).length === 0) return current;
  return withTransaction(ctx, async (tx) => {
    const [row] = await tx.db
      .update(campaigns)
      .set({ ...next, updatedAt: tx.clock.now() })
      .where(eq(campaigns.id, current.id))
      .returning();
    await recordAudit(tx, {
      action: 'campaign.updated',
      targetType: 'campaign',
      targetId: current.id,
      context: { changes },
    });
    return row!;
  });
}

/** What references a campaign. Any reference keeps it from being deleted. */
export interface CampaignUsage {
  /** Mirrored invites attached to it, including ones Discord has since deleted. */
  attachedInvites: number;
  /** Of those, invites Discord no longer lists (they can still be detached). */
  deletedInvites: number;
  /** Referral codes issued for it, active or not. */
  referralCodes: number;
  /** Referrals credited to it. */
  referrals: number;
  /** Nothing references it: deleteCampaign succeeds. */
  deletable: boolean;
}

async function loadCampaignUsage(ctx: ServiceContext, campaignId: string): Promise<CampaignUsage> {
  const countOf = (value: { value: number } | undefined) => value?.value ?? 0;
  const [[invitesAttached], [invitesDeleted], [codes], [credited]] = await Promise.all([
    ctx.db
      .select({ value: count() })
      .from(inviteCodes)
      .where(eq(inviteCodes.campaignId, campaignId)),
    ctx.db
      .select({ value: count() })
      .from(inviteCodes)
      .where(and(eq(inviteCodes.campaignId, campaignId), isNotNull(inviteCodes.deletedAt))),
    ctx.db
      .select({ value: count() })
      .from(referralCodes)
      .where(eq(referralCodes.campaignId, campaignId)),
    ctx.db.select({ value: count() }).from(referrals).where(eq(referrals.campaignId, campaignId)),
  ]);
  const usage = {
    attachedInvites: countOf(invitesAttached),
    deletedInvites: countOf(invitesDeleted),
    referralCodes: countOf(codes),
    referrals: countOf(credited),
  };
  return {
    ...usage,
    deletable: usage.attachedInvites === 0 && usage.referralCodes === 0 && usage.referrals === 0,
  };
}

/** What references a campaign, and so whether it can be deleted (canViewAnalytics). */
export async function getCampaignUsage(
  ctx: ServiceContext,
  campaignId: string,
): Promise<CampaignUsage> {
  const id = parseInput(z.uuid(), campaignId);
  await authorize(ctx, 'canViewAnalytics', { type: 'campaign', id });
  await loadCampaign(ctx, id);
  return loadCampaignUsage(ctx, id);
}

/**
 * Delete a campaign that nothing references (see getCampaignUsage).
 * Campaigns with invites, codes or referrals keep their history: detach
 * their invites, or deactivate them instead.
 */
export async function deleteCampaign(ctx: ServiceContext, campaignId: string): Promise<void> {
  const id = parseInput(z.uuid(), campaignId);
  await authorize(ctx, 'canManageCampaigns', { type: 'campaign', id });
  const campaign = await loadCampaign(ctx, id);
  const usage = await loadCampaignUsage(ctx, id);
  if (!usage.deletable) {
    throw new ConflictError('This campaign has attributed activity. Deactivate it instead.');
  }
  await withTransaction(ctx, async (tx) => {
    await tx.db.delete(campaigns).where(eq(campaigns.id, id));
    await recordAudit(tx, {
      action: 'campaign.deleted',
      targetType: 'campaign',
      targetId: id,
      context: { key: campaign.key },
    });
  });
}

export interface CampaignView extends CampaignRecord {
  acceptingNow: boolean;
  funnel: ReferralFunnel;
}

export async function getCampaign(ctx: ServiceContext, campaignId: string): Promise<CampaignView> {
  const id = parseInput(z.uuid(), campaignId);
  await authorize(ctx, 'canViewAnalytics', { type: 'campaign', id });
  const campaign = await loadCampaign(ctx, id);
  const funnels = await loadFunnels(ctx, { groupBy: 'campaign', campaignIds: [id] });
  return {
    ...campaign,
    acceptingNow: campaignAccepts(campaign, ctx.clock.now()),
    funnel: funnels.get(id) ?? emptyFunnel(),
  };
}

export const listCampaignsSchema = z.object({
  includeInactive: z.boolean().default(false),
});

/** Campaigns with their funnels (two aggregate queries, no N+1). */
export async function listCampaigns(
  ctx: ServiceContext,
  input: z.input<typeof listCampaignsSchema> = {},
): Promise<CampaignView[]> {
  const data = parseInput(listCampaignsSchema, input);
  await authorize(ctx, 'canViewAnalytics', { type: 'campaign' });
  const rows = await ctx.db
    .select()
    .from(campaigns)
    .where(data.includeInactive ? undefined : eq(campaigns.active, true))
    .orderBy(desc(campaigns.active), asc(campaigns.key));
  const funnels = await loadFunnels(ctx, {
    groupBy: 'campaign',
    campaignIds: rows.map((r) => r.id),
  });
  const now = ctx.clock.now();
  return rows.map((row) => ({
    ...row,
    acceptingNow: campaignAccepts(row, now),
    funnel: funnels.get(row.id) ?? emptyFunnel(),
  }));
}

/**
 * Attach a live Discord invite to a campaign, or detach an invite from its
 * campaign. Detaching also works for an invite Discord has since deleted, so
 * no attachment is ever stuck. Only future joins through the invite are
 * credited to the campaign; history is not rewritten.
 */
export async function attachInviteToCampaign(
  ctx: ServiceContext,
  input: z.input<typeof attachInviteSchema>,
) {
  const data = parseInput(attachInviteSchema, input);
  await authorize(ctx, 'canManageCampaigns', { type: 'invite', id: data.code });
  const attaching = data.campaignId !== null;
  const [invite] = await ctx.db
    .select()
    .from(inviteCodes)
    .where(
      attaching
        ? and(eq(inviteCodes.code, data.code), isNull(inviteCodes.deletedAt))
        : eq(inviteCodes.code, data.code),
    );
  if (!invite) throw new NotFoundError('Invite');
  if (data.campaignId) await loadCampaign(ctx, data.campaignId);
  if (invite.campaignId === data.campaignId) return invite;
  return withTransaction(ctx, async (tx) => {
    const [row] = await tx.db
      .update(inviteCodes)
      .set({ campaignId: data.campaignId })
      .where(eq(inviteCodes.code, invite.code))
      .returning();
    await recordAudit(tx, {
      action: data.campaignId ? 'invite.campaign_attached' : 'invite.campaign_detached',
      targetType: 'invite',
      targetId: invite.code,
      context: { from: invite.campaignId, to: data.campaignId },
    });
    return row!;
  });
}

/**
 * Detach `code` from `campaignId`, and only from it: one conditional update,
 * so a stale page or card naming a campaign the invite has since left changes
 * nothing (NOT FOUND). Works for invites Discord has deleted, so no
 * attachment is ever stuck. Past referrals keep their credit.
 */
export async function detachInviteFromCampaign(
  ctx: ServiceContext,
  input: z.input<typeof detachInviteSchema>,
) {
  const data = parseInput(detachInviteSchema, input);
  await authorize(ctx, 'canManageCampaigns', { type: 'invite', id: data.code });
  return withTransaction(ctx, async (tx) => {
    const [row] = await tx.db
      .update(inviteCodes)
      .set({ campaignId: null })
      .where(and(eq(inviteCodes.code, data.code), eq(inviteCodes.campaignId, data.campaignId)))
      .returning();
    if (!row) throw new NotFoundError('Invite');
    await recordAudit(tx, {
      action: 'invite.campaign_detached',
      targetType: 'invite',
      targetId: row.code,
      context: { from: data.campaignId, to: null },
    });
    return row;
  });
}
