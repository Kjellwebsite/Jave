import { randomBytes } from 'node:crypto';
import { type Clock, MINUTE, type moderation } from '@jave/core';

/**
 * Short-lived, per-process state for two-step flows whose data does not fit
 * in a custom id (a kick/ban awaiting CONFIRM, a Delete & warn awaiting its
 * reason). Tokens are random and bound to the issuing user; a token is
 * consumed once. After a restart pending steps expire — the safe default.
 */
export const PENDING_TTL_MS = 10 * MINUTE;
/** Hard cap on live entries; the oldest are evicted first. */
export const MAX_PENDING_ENTRIES = 500;
const TOKEN_BYTES = 12;

/** warn · timeout · untimeout · kick · ban · unban · quarantine · release · note */
export type CaseActionKey = moderation.ModAction;

export interface PendingCaseAction {
  kind: 'case';
  issuerDiscordId: string;
  action: CaseActionKey;
  targetDiscordId: string;
  targetName: string;
  reason: string;
  durationSeconds?: number;
  deleteMessageDays?: number;
}

export interface PendingDeleteWarn {
  kind: 'delete_warn';
  issuerDiscordId: string;
  channelId: string;
  messageId: string;
  authorDiscordId: string;
  authorName: string;
  content: string;
}

export type PendingEntry = PendingCaseAction | PendingDeleteWarn;

export type PendingLookup<T extends PendingEntry> =
  { ok: true; entry: T } | { ok: false; reason: 'expired' | 'not_yours' };

export class PendingStore {
  private readonly entries = new Map<string, { entry: PendingEntry; expiresAt: number }>();

  constructor(private readonly clock: Clock) {}

  private now(): number {
    return this.clock.now().getTime();
  }

  private prune(): void {
    const now = this.now();
    for (const [token, item] of this.entries) {
      if (item.expiresAt <= now) this.entries.delete(token);
    }
    // Map iteration is insertion order: evict the oldest beyond the cap.
    while (this.entries.size >= MAX_PENDING_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  put(entry: PendingEntry): string {
    this.prune();
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    this.entries.set(token, { entry, expiresAt: this.now() + PENDING_TTL_MS });
    return token;
  }

  private lookup<K extends PendingEntry['kind']>(
    token: string,
    kind: K,
    userDiscordId: string,
  ): PendingLookup<Extract<PendingEntry, { kind: K }>> {
    const item = this.entries.get(token);
    if (!item || item.expiresAt <= this.now() || item.entry.kind !== kind) {
      return { ok: false, reason: 'expired' };
    }
    if (item.entry.issuerDiscordId !== userDiscordId) return { ok: false, reason: 'not_yours' };
    return { ok: true, entry: item.entry as Extract<PendingEntry, { kind: K }> };
  }

  /** Read and consume: a second click on the same confirmation finds nothing. */
  take<K extends PendingEntry['kind']>(
    token: string,
    kind: K,
    userDiscordId: string,
  ): PendingLookup<Extract<PendingEntry, { kind: K }>> {
    const found = this.lookup(token, kind, userDiscordId);
    if (found.ok) this.entries.delete(token);
    return found;
  }

  /** Drop a pending step (CANCEL). Only its issuer can. */
  discard(token: string, userDiscordId: string): 'discarded' | 'missing' | 'not_yours' {
    const item = this.entries.get(token);
    if (!item || item.expiresAt <= this.now()) return 'missing';
    if (item.entry.issuerDiscordId !== userDiscordId) return 'not_yours';
    this.entries.delete(token);
    return 'discarded';
  }

  get size(): number {
    return this.entries.size;
  }
}

/** One store per bot process (per BotServices instance, so test harnesses stay isolated). */
const stores = new WeakMap<object, PendingStore>();

export function pendingStoreFor(owner: object, clock: Clock): PendingStore {
  let store = stores.get(owner);
  if (!store) {
    store = new PendingStore(clock);
    stores.set(owner, store);
  }
  return store;
}
