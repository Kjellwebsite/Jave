import {
  createContext,
  invites,
  type ServiceContext,
  systemActor,
  upsertDiscordUser,
} from '@jave/core';
import type { InviteSnapshot } from '../../discord/gateway';
import type { JoinedMember } from '../../gateway-events/types';
import type { BotServices } from '../../runtime';

/**
 * Invite tracker: keeps the last observed invite snapshot in memory, mirrors
 * it into JAVE, and attributes each join to the invite whose use count rose.
 *
 * Race safety: every operation (resync, join attribution) runs on one serial
 * queue, so each join's "before" is the "after" of the operation that ran
 * just before it, plus any pending uses (below). Detection itself never
 * guesses (see detectUsedInvite): anything but exactly one invite rising by
 * exactly one use is `unknown`.
 *
 * Uses a resync absorbs: a resync that runs between a join and its member
 * add (an unrelated invite event, or the INVITE_DELETE Discord sends when
 * the use consumed an invite's last use, which may arrive before
 * GUILD_MEMBER_ADD) would move the baseline past that use and leave the join
 * diff with nothing to find. So when a resync sees an invite's uses rise, or
 * an invite with exactly one use left vanish, the previous entry stays in the
 * baseline as a pending use for the next join diff only, and for at most
 * PENDING_USE_GRACE_MS. A pending use that meets another use in the same diff
 * makes that join ambiguous (unknown), never a false credit.
 */

/** Discord usernames are at most 32 characters; the mirror accepts up to 64. */
const MAX_INVITER_USERNAME_LENGTH = 64;

/**
 * How long a use absorbed by a resync stays pending in the detection
 * baseline. Discord dispatches the invite update and the member add for one
 * join together; the grace covers queue delay. It stays short because a
 * staff-deleted invite with one use left, or a use whose member add never
 * arrives, looks the same and must not hold up later joins.
 */
export const PENDING_USE_GRACE_MS = 30_000;

interface PendingUse {
  /** The invite as the baseline saw it before the resync absorbed the use. */
  usage: invites.InviteUsage;
  /** Epoch milliseconds after which the entry no longer counts. */
  expiresAt: number;
}

export type UnknownJoinReason = invites.UnknownInviteReason | 'fetch_failed';

export interface JoinOutcome {
  method: invites.InviteDetection['method'];
  /** The detected invite code, or null when the source is unknown. */
  code: string | null;
  /** Why the source is unknown (null when detected). */
  reason: UnknownJoinReason | null;
  referralId: string;
  /** False when this join had already been attributed (idempotent retry). */
  created: boolean;
}

export type ResyncOutcome =
  | { synced: true; invites: number; removed: number }
  | { synced: false; reason: 'fetch_failed' | 'sync_failed' };

export function toInviteUsage(snapshot: InviteSnapshot): invites.InviteUsage {
  return {
    code: snapshot.code,
    uses: snapshot.uses,
    maxUses: snapshot.maxUses,
    vanity: snapshot.vanity ?? false,
  };
}

/** Gateway snapshot → the core mirror's input (1:1, plus the inviter's name when known). */
export function toSyncInput(snapshot: InviteSnapshot): invites.InviteSnapshotInput {
  const username = snapshot.inviterUsername?.trim().slice(0, MAX_INVITER_USERNAME_LENGTH);
  return {
    code: snapshot.code,
    inviterDiscordId: snapshot.inviterDiscordId,
    inviterUsername: username ? username : undefined,
    channelId: snapshot.channelId,
    uses: snapshot.uses,
    maxUses: snapshot.maxUses,
    temporary: snapshot.temporary,
    createdAt: snapshot.createdAt,
    expiresAt: snapshot.expiresAt,
    vanity: snapshot.vanity ?? false,
  };
}

export class InviteTracker {
  /** Last complete snapshot observed from Discord; null until the first successful fetch. */
  private cache: invites.InviteUsage[] | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  /** A resync waiting in the queue; invite-event bursts share it. */
  private pendingResync: Promise<ResyncOutcome> | null = null;
  /** Pre-resync entries of invites whose uses a resync absorbed, by code. */
  private readonly pending = new Map<string, PendingUse>();

  constructor(private readonly services: BotServices) {}

  private context(reason: string): ServiceContext {
    const { db, clock, cache, config, logger } = this.services;
    return createContext({ db, clock, cache, config, logger, actor: systemActor(reason) });
  }

  /** Run `work` after everything queued before it has settled. */
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(work, work);
    this.tail = run.catch(() => undefined);
    return run;
  }

  /** Complete snapshot from Discord, or null when the fetch failed (never a partial list). */
  private async fetchSnapshot(purpose: string): Promise<InviteSnapshot[] | null> {
    try {
      return await this.services.gateway.listInvites();
    } catch (error) {
      this.services.logger.warn(
        { err: error, purpose },
        'invite fetch failed (the bot needs Manage Guild to read invites)',
      );
      return null;
    }
  }

  /** Mirror a complete snapshot. A failed mirror never blocks detection. */
  private async mirror(ctx: ServiceContext, snapshot: readonly InviteSnapshot[]) {
    try {
      return await invites.syncInvites(ctx, snapshot.map(toSyncInput));
    } catch (error) {
      this.services.logger.error({ err: error, invites: snapshot.length }, 'invite mirror failed');
      return null;
    }
  }

  /**
   * Keep the pre-resync entry of every invite whose uses rose between the
   * cached snapshot and `next`, or that vanished with exactly one use left.
   * An entry still pending keeps its older baseline; an expired one is replaced.
   */
  private rememberAbsorbedUses(next: readonly invites.InviteUsage[]): void {
    if (!this.cache) return;
    const after = new Map(next.map((usage) => [usage.code, usage]));
    const now = this.services.clock.now().getTime();
    for (const usage of this.cache) {
      const current = after.get(usage.code);
      const absorbed = current ? current.uses > usage.uses : invites.lastUseConsumed(usage);
      const existing = this.pending.get(usage.code);
      if (absorbed && (!existing || existing.expiresAt <= now)) {
        this.pending.set(usage.code, { usage, expiresAt: now + PENDING_USE_GRACE_MS });
      }
    }
  }

  /** The cached snapshot with unexpired pending uses restored; null while the cache is cold. */
  private baseline(): invites.InviteUsage[] | null {
    if (!this.cache) return null;
    const now = this.services.clock.now().getTime();
    const byCode = new Map(this.cache.map((usage) => [usage.code, usage]));
    for (const [code, entry] of this.pending) {
      if (entry.expiresAt <= now) this.pending.delete(code);
      else byCode.set(code, entry.usage);
    }
    return [...byCode.values()];
  }

  /**
   * Re-read every invite and mirror it (ready, inviteCreate, inviteDelete).
   * Coalesced: while one resync waits in the queue, further requests share it.
   */
  resync(reason: string): Promise<ResyncOutcome> {
    if (this.pendingResync) return this.pendingResync;
    const queued = this.serialize(async (): Promise<ResyncOutcome> => {
      // From here on, a new invite event needs a fetch of its own.
      this.pendingResync = null;
      const snapshot = await this.fetchSnapshot(reason);
      if (!snapshot) return { synced: false, reason: 'fetch_failed' };
      const next = snapshot.map(toInviteUsage);
      this.rememberAbsorbedUses(next);
      this.cache = next;
      const result = await this.mirror(this.context(`gateway:invites-${reason}`), snapshot);
      if (!result) return { synced: false, reason: 'sync_failed' };
      return { synced: true, invites: result.synced, removed: result.removed };
    });
    this.pendingResync = queued;
    return queued;
  }

  /** Attribute a (non-bot) join. Serialized with every other tracker operation. */
  attributeJoin(member: JoinedMember): Promise<JoinOutcome> {
    return this.serialize(() => this.attribute(member));
  }

  private async attribute(member: JoinedMember): Promise<JoinOutcome> {
    const ctx = this.context('gateway:invite-attribution');
    // Cold cache (restart, or no successful fetch yet): the mirror is the baseline.
    const before = this.baseline() ?? (await invites.inviteUsageSnapshot(ctx));
    const after = await this.fetchSnapshot('member-join');
    let detection: invites.InviteDetection | null = null;
    if (after) {
      const usage = after.map(toInviteUsage);
      detection = invites.detectUsedInvite(before, usage);
      this.cache = usage;
      // Every pending use had its one chance: credited, or part of an ambiguous diff.
      this.pending.clear();
      // Mirror first: an invite created moments ago is then known with its inviter.
      await this.mirror(ctx, after);
    }
    // The core feature records the join concurrently; the user row is shared and idempotent.
    const user = await upsertDiscordUser(ctx, {
      discordId: member.id,
      username: member.username,
      displayName: member.globalName,
      avatarHash: member.avatar,
    });
    const { referral, created } = await invites.attributeJoin(ctx, {
      inviteeUserId: user.id,
      usedCode: detection?.code ?? null,
      vanity: detection?.method === 'vanity',
      joinedAt: member.joinedAt,
    });
    await this.services.runJobsNow(ctx.effects.jobIds);
    return {
      method: detection?.method ?? 'unknown',
      code: detection?.code ?? null,
      reason: !detection
        ? 'fetch_failed'
        : detection.method === 'unknown'
          ? detection.reason
          : null,
      referralId: referral.id,
      created,
    };
  }
}

/** One tracker per running bot (and per test harness). */
const trackers = new WeakMap<BotServices, InviteTracker>();

export function trackerFor(services: BotServices): InviteTracker {
  let tracker = trackers.get(services);
  if (!tracker) {
    tracker = new InviteTracker(services);
    trackers.set(services, tracker);
  }
  return tracker;
}
