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
 * queue, so each join's "before" is exactly the "after" of the operation that
 * ran just before it. Detection itself never guesses (see detectUsedInvite):
 * anything but exactly one invite rising by exactly one use is `unknown`.
 *
 * Consumed invites: the use that brings a member in through an invite with
 * one use left makes Discord delete it, and Discord may deliver that
 * INVITE_DELETE before GUILD_MEMBER_ADD. A resync in between would drop the
 * code from the baseline and leave the join diff with nothing to find. So an
 * invite that vanishes from a resync with exactly one use left stays in the
 * baseline as a tombstone for the next join diff only, and for at most
 * CONSUMED_INVITE_GRACE_MS.
 */

/** Discord usernames are at most 32 characters; the mirror accepts up to 64. */
const MAX_INVITER_USERNAME_LENGTH = 64;

/**
 * How long a vanished last-use invite stays in the detection baseline.
 * Discord dispatches the delete and the member add for one join together;
 * the grace covers queue delay. It stays short because a staff-deleted
 * invite with one use left looks the same, and must not collect credit.
 */
export const CONSUMED_INVITE_GRACE_MS = 30_000;

interface ConsumedInvite {
  usage: invites.InviteUsage;
  /** Epoch milliseconds after which the tombstone no longer counts. */
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
  /** Tombstones: invites a resync saw vanish with exactly one use left, by code. */
  private readonly consumed = new Map<string, ConsumedInvite>();

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
   * Remember invites that vanished between the cached snapshot and `next`
   * with exactly one use left; forget tombstones whose code is live again.
   */
  private rememberConsumed(next: readonly invites.InviteUsage[]): void {
    const live = new Set(next.map((usage) => usage.code));
    for (const code of live) this.consumed.delete(code);
    if (!this.cache) return;
    const expiresAt = this.services.clock.now().getTime() + CONSUMED_INVITE_GRACE_MS;
    for (const usage of this.cache) {
      if (!live.has(usage.code) && invites.lastUseConsumed(usage)) {
        this.consumed.set(usage.code, { usage, expiresAt });
      }
    }
  }

  /** The cached snapshot plus unexpired tombstones; null while the cache is cold. */
  private baseline(): invites.InviteUsage[] | null {
    if (!this.cache) return null;
    const now = this.services.clock.now().getTime();
    const tombstones: invites.InviteUsage[] = [];
    for (const [code, entry] of this.consumed) {
      if (entry.expiresAt <= now) this.consumed.delete(code);
      else tombstones.push(entry.usage);
    }
    return [...this.cache, ...tombstones];
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
      this.rememberConsumed(next);
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
      // Every tombstone had its one chance: credited, or part of an ambiguous diff.
      this.consumed.clear();
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
