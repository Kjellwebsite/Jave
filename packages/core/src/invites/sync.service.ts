import { and, count, desc, eq, inArray, isNull, notInArray, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { inviteCodes, members, users } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { type Page, pageSchema } from '../kernel/pagination';
import { parseInput } from '../kernel/validation';
import { authorize } from '../permissions/authorize';
import { upsertDiscordUser } from '../identity/users.service';
import { requireSystemActor } from './access';
import { DISCORD_MAX_GUILD_INVITES, MAX_SYNCED_INVITES } from './constants';
import type { InviteUsage } from './detect';

export type InviteCodeRecord = typeof inviteCodes.$inferSelect;

/** Discord invite codes (and vanity codes) are short URL-safe tokens. */
export const INVITE_CODE_PATTERN = /^[A-Za-z0-9-]{2,32}$/;
/** Sanity bound for use counts (the column is a 32-bit integer). */
const MAX_INVITE_USES = 1_000_000_000;

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord ID');

export const inviteSnapshotSchema = z.object({
  code: z.string().regex(INVITE_CODE_PATTERN, 'invalid invite code'),
  inviterDiscordId: snowflake.nullable().optional(),
  /** Used only when JAVE has never seen the inviter; existing names are never overwritten. */
  inviterUsername: z.string().trim().min(1).max(64).optional(),
  channelId: snowflake.nullable().optional(),
  uses: z.number().int().min(0).max(MAX_INVITE_USES),
  /** 0 or null = unlimited (Discord reports 0). */
  maxUses: z.number().int().min(0).max(MAX_INVITE_USES).nullable().optional(),
  temporary: z.boolean().default(false),
  createdAt: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  /** Marks the guild's vanity URL. */
  vanity: z.boolean().default(false),
});

export type InviteSnapshotInput = z.input<typeof inviteSnapshotSchema>;

export const syncInvitesSchema = z
  .array(inviteSnapshotSchema)
  .max(MAX_SYNCED_INVITES)
  .superRefine((invites, issue) => {
    const seen = new Set<string>();
    for (const [index, invite] of invites.entries()) {
      if (seen.has(invite.code)) {
        issue.addIssue({ code: 'custom', message: 'duplicate invite code', path: [index, 'code'] });
      }
      seen.add(invite.code);
    }
    const vanityCount = invites.filter((i) => i.vanity).length;
    if (vanityCount > 1) {
      issue.addIssue({ code: 'custom', message: 'only one vanity code per guild' });
    }
    if (invites.length - vanityCount > DISCORD_MAX_GUILD_INVITES) {
      issue.addIssue({ code: 'custom', message: 'more invites than a guild can hold' });
    }
  });

export interface SyncInvitesResult {
  synced: number;
  /** Codes no longer present on Discord, now marked deleted. */
  removed: number;
  /** Inviters JAVE had never seen, created with a minimal profile. */
  createdUsers: number;
}

/** Name used for an inviter JAVE has never seen when the bot gave no username. */
function placeholderUsername(discordId: string): string {
  return `unknown-${discordId.slice(-6)}`;
}

/**
 * Create users for inviters JAVE has never seen. Runs outside the sync
 * transaction: user creation is idempotent and races are resolved by
 * upsertDiscordUser, which cannot recover inside an aborted transaction.
 */
async function ensureInviters(
  ctx: ServiceContext,
  invites: z.infer<typeof syncInvitesSchema>,
): Promise<{ userIds: Map<string, string>; created: number }> {
  const inviterIds = [
    ...new Set(invites.flatMap((i) => (i.inviterDiscordId ? [i.inviterDiscordId] : []))),
  ];
  if (inviterIds.length === 0) return { userIds: new Map(), created: 0 };
  const known = await ctx.db
    .select({ id: users.id, discordId: users.discordId })
    .from(users)
    .where(inArray(users.discordId, inviterIds));
  const userIds = new Map(known.map((u) => [u.discordId, u.id]));
  let created = 0;
  for (const invite of invites) {
    const discordId = invite.inviterDiscordId;
    if (!discordId || userIds.has(discordId)) continue;
    const user = await upsertDiscordUser(ctx, {
      discordId,
      username: invite.inviterUsername ?? placeholderUsername(discordId),
    });
    userIds.set(discordId, user.id);
    created++;
  }
  return { userIds, created };
}

/**
 * Replace the invite mirror with a complete snapshot of the guild's invites
 * (bot: on ready, inviteCreate, inviteDelete, and after each join). Codes
 * missing from the snapshot are marked deleted; reappearing codes revive.
 * Campaign links are preserved. System actor only.
 *
 * The snapshot must be complete: on a failed fetch the bot must not call this
 * (an empty list legitimately means "the guild has no invites").
 */
export async function syncInvites(
  ctx: ServiceContext,
  input: readonly InviteSnapshotInput[],
): Promise<SyncInvitesResult> {
  await requireSystemActor(ctx, { type: 'invite' });
  const invites = parseInput(syncInvitesSchema, input);
  const { userIds, created } = await ensureInviters(ctx, invites);
  const now = ctx.clock.now();
  return withTransaction(ctx, async (tx) => {
    if (invites.length > 0) {
      await tx.db
        .insert(inviteCodes)
        .values(
          invites.map((invite) => ({
            code: invite.code,
            inviterUserId: invite.inviterDiscordId
              ? (userIds.get(invite.inviterDiscordId) ?? null)
              : null,
            channelId: invite.channelId ?? null,
            uses: invite.uses,
            maxUses: invite.maxUses ? invite.maxUses : null,
            temporary: invite.temporary,
            isVanity: invite.vanity,
            createdAt: invite.createdAt ?? now,
            expiresAt: invite.expiresAt ?? null,
            deletedAt: null,
            lastSyncedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: inviteCodes.code,
          set: {
            inviterUserId: sql`coalesce(excluded.inviter_user_id, ${inviteCodes.inviterUserId})`,
            channelId: sql`excluded.channel_id`,
            uses: sql`excluded.uses`,
            maxUses: sql`excluded.max_uses`,
            temporary: sql`excluded.temporary`,
            isVanity: sql`excluded.is_vanity`,
            expiresAt: sql`excluded.expires_at`,
            deletedAt: null,
            lastSyncedAt: now,
          },
        });
    }
    const liveFilters: SQL[] = [isNull(inviteCodes.deletedAt)];
    if (invites.length > 0) {
      liveFilters.push(
        notInArray(
          inviteCodes.code,
          invites.map((i) => i.code),
        ),
      );
    }
    const removed = await tx.db
      .update(inviteCodes)
      .set({ deletedAt: now, lastSyncedAt: now })
      .where(and(...liveFilters))
      .returning({ code: inviteCodes.code });
    return { synced: invites.length, removed: removed.length, createdUsers: created };
  });
}

/**
 * The mirror as a detection baseline, for a bot whose in-memory invite cache
 * is cold (e.g. just restarted). System actor only.
 */
export async function inviteUsageSnapshot(ctx: ServiceContext): Promise<InviteUsage[]> {
  await requireSystemActor(ctx, { type: 'invite' });
  return ctx.db
    .select({
      code: inviteCodes.code,
      uses: inviteCodes.uses,
      maxUses: inviteCodes.maxUses,
      vanity: inviteCodes.isVanity,
    })
    .from(inviteCodes)
    .where(isNull(inviteCodes.deletedAt));
}

export const listInviteCodesSchema = pageSchema.extend({
  campaignId: z.uuid().optional(),
  includeDeleted: z.boolean().default(false),
});

export interface InviteCodeView {
  code: string;
  inviterUserId: string | null;
  inviterName: string | null;
  inviterMemberId: string | null;
  channelId: string | null;
  uses: number;
  maxUses: number | null;
  temporary: boolean;
  vanity: boolean;
  campaignId: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  deletedAt: Date | null;
}

/** Staff listing of mirrored invites (for attaching invites to campaigns). */
export async function listInviteCodes(
  ctx: ServiceContext,
  input: z.input<typeof listInviteCodesSchema> = {},
): Promise<Page<InviteCodeView>> {
  const q = parseInput(listInviteCodesSchema, input);
  await authorize(ctx, 'canViewAnalytics', { type: 'invite' });
  const filters: SQL[] = [];
  if (!q.includeDeleted) filters.push(isNull(inviteCodes.deletedAt));
  if (q.campaignId) filters.push(eq(inviteCodes.campaignId, q.campaignId));
  const where = filters.length > 0 ? and(...filters) : undefined;
  const [rows, [total]] = await Promise.all([
    ctx.db
      .select({
        code: inviteCodes.code,
        inviterUserId: inviteCodes.inviterUserId,
        inviterName: sql<
          string | null
        >`coalesce(${members.displayName}, ${users.displayName}, ${users.username})`,
        inviterMemberId: members.id,
        channelId: inviteCodes.channelId,
        uses: inviteCodes.uses,
        maxUses: inviteCodes.maxUses,
        temporary: inviteCodes.temporary,
        vanity: inviteCodes.isVanity,
        campaignId: inviteCodes.campaignId,
        createdAt: inviteCodes.createdAt,
        expiresAt: inviteCodes.expiresAt,
        deletedAt: inviteCodes.deletedAt,
      })
      .from(inviteCodes)
      .leftJoin(users, eq(users.id, inviteCodes.inviterUserId))
      .leftJoin(members, eq(members.userId, inviteCodes.inviterUserId))
      .where(where)
      .orderBy(desc(inviteCodes.uses), inviteCodes.code)
      .limit(q.limit)
      .offset(q.offset),
    ctx.db.select({ value: count() }).from(inviteCodes).where(where),
  ]);
  return { items: rows, total: total?.value ?? 0, limit: q.limit, offset: q.offset };
}
