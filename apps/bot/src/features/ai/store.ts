import { randomBytes } from 'node:crypto';

/** 9 random bytes → 12 base64url characters: unguessable, short enough for custom ids. */
const ID_BYTES = 9;

export interface ExpiringStoreLimits {
  /** How long an entry lives. */
  ttlMs: number;
  /** Entries held per process; the oldest is dropped first. */
  maxEntries: number;
  /**
   * Entries held per owner; the owner's own oldest is dropped first. Keeps
   * one member from evicting everyone else's entries by filling the store.
   */
  maxPerOwner: number;
}

/**
 * Bounded, expiring, in-memory store for interaction state that must survive
 * between a reply and a later button or modal (answer pages, a message that
 * awaits a question). Per process by design: AI answers are never written to
 * the database, and a restart simply makes old controls read as EXPIRED.
 * Ids are random, so a guessed or forged id finds nothing; every read also
 * checks the owner.
 */
export class ExpiringStore<T extends { ownerId: string }> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();
  /** Each owner's ids, oldest first (never longer than `maxPerOwner`). */
  private readonly owned = new Map<string, string[]>();

  constructor(private readonly limits: ExpiringStoreLimits) {
    if (limits.maxPerOwner < 1 || limits.maxEntries < limits.maxPerOwner) {
      throw new RangeError('ExpiringStore limits: 1 ≤ maxPerOwner ≤ maxEntries.');
    }
  }

  get size(): number {
    return this.entries.size;
  }

  put(value: T, nowMs: number): string {
    this.prune(nowMs);
    const ownIds = this.owned.get(value.ownerId) ?? [];
    const overOwnerCap = ownIds.length + 1 - this.limits.maxPerOwner;
    // Iterate a copy: delete() rewrites the owner's list.
    if (overOwnerCap > 0) for (const oldest of ownIds.slice(0, overOwnerCap)) this.delete(oldest);
    while (this.entries.size >= this.limits.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.delete(oldest.value);
    }
    const id = randomBytes(ID_BYTES).toString('base64url');
    this.entries.set(id, { value, expiresAt: nowMs + this.limits.ttlMs });
    this.owned.set(value.ownerId, [...(this.owned.get(value.ownerId) ?? []), id]);
    return id;
  }

  /** The live entry, or null when missing or expired. */
  get(id: string, nowMs: number): T | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (entry.expiresAt <= nowMs) {
      this.delete(id);
      return null;
    }
    return entry.value;
  }

  delete(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    const ownerId = entry.value.ownerId;
    const remaining = (this.owned.get(ownerId) ?? []).filter((ownedId) => ownedId !== id);
    if (remaining.length > 0) this.owned.set(ownerId, remaining);
    else this.owned.delete(ownerId);
  }

  /** Insertion order is expiry order (one TTL), so pruning stops at the first live entry. */
  private prune(nowMs: number): void {
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt > nowMs) break;
      this.delete(id);
    }
  }
}
