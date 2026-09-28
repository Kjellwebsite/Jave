/**
 * Deterministic pseudo-random numbers for the development seed. The same
 * seed string always produces the same organization, so screenshots, demos
 * and bug reports refer to the same people and records.
 *
 * Not for anything security-relevant: mulberry32 is fast and well
 * distributed, and that is all the seed needs.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const UINT32_RANGE = 0x1_0000_0000;
const MULBERRY_INCREMENT = 0x6d2b79f5;

/** FNV-1a hash of a string, as an unsigned 32-bit integer. */
function hashSeed(seed: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

export class SeededRandom {
  private state: number;

  constructor(seed: string) {
    this.state = hashSeed(seed);
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + MULBERRY_INCREMENT) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  }

  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    if (max < min) throw new RangeError(`empty range ${min}..${max}`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with the given probability. */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('cannot pick from an empty list');
    return items[this.int(0, items.length - 1)]!;
  }

  /** A shuffled copy (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let index = out.length - 1; index > 0; index--) {
      const swap = this.int(0, index);
      [out[index], out[swap]] = [out[swap]!, out[index]!];
    }
    return out;
  }
}
