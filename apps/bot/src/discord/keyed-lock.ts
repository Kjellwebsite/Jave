/**
 * In-process mutual exclusion per key. Job handlers that fully re-sync one
 * Discord object (an event's announcement, a game panel) run under the key
 * of that object, so two runs in this process never interleave their reads
 * and writes. Across processes, the core compare-and-set callbacks remain
 * the backstop.
 */
export class KeyedLock {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => held);
    this.tails.set(key, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  /** Keys with a holder or waiters (for tests and diagnostics). */
  get size(): number {
    return this.tails.size;
  }
}
