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
 */

/** Discord usernames are at most 32 characters; the mirror accepts up to 64. */
const MAX_INVITER_USERNAME_LENGTH = 64;

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
      this.cache = snapshot.map(toInviteUsage);
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
    const before = this.cache ?? (await invites.inviteUsageSnapshot(ctx));
    const after = await this.fetchSnapshot('member-join');
    let detection: invites.InviteDetection | null = null;
    if (after) {
      const usage = after.map(toInviteUsage);
      detection = invites.detectUsedInvite(before, usage);
      this.cache = usage;
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
