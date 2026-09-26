import { randomBytes } from 'node:crypto';

/** 9 random bytes → 12 base64url characters: unguessable, short enough for custom ids. */
const ID_BYTES = 9;

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

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  put(value: T, nowMs: number): string {
    this.prune(nowMs);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    const id = randomBytes(ID_BYTES).toString('base64url');
    this.entries.set(id, { value, expiresAt: nowMs + this.ttlMs });
    return id;
  }

  /** The live entry, or null when missing or expired. */
  get(id: string, nowMs: number): T | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (entry.expiresAt <= nowMs) {
      this.entries.delete(id);
      return null;
    }
    return entry.value;
  }

  delete(id: string): void {
    this.entries.delete(id);
  }

  /** Insertion order is expiry order (one TTL), so pruning stops at the first live entry. */
  private prune(nowMs: number): void {
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt > nowMs) break;
      this.entries.delete(id);
    }
  }
}
