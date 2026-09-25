/**
 * Seeded pseudo-random number generation. Deterministic for a given seed on
 * every platform: cyrb128 turns the seed string into 128 bits of state and
 * sfc32 generates from it. Not cryptographic — use it for game setup and
 * shuffles that must be reproducible, never for secrets.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** A shuffled copy (Fisher–Yates); the input is not modified. */
  shuffle<T>(items: readonly T[]): T[];
}

const UINT32_RANGE = 4_294_967_296;
/** sfc32 needs a few rounds before its output decorrelates from the seed. */
const WARMUP_ROUNDS = 12;

function cyrb128(input: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < input.length; i++) {
    const k = input.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export function createRng(seed: string): Rng {
  let [a, b, c, d] = cyrb128(seed);
  const nextUint32 = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < WARMUP_ROUNDS; i++) nextUint32();

  const next = () => nextUint32() / UINT32_RANGE;
  const int = (maxExclusive: number): number => {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError('maxExclusive must be a positive integer');
    }
    return Math.floor(next() * maxExclusive);
  };
  const shuffle = <T>(items: readonly T[]): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
  return { next, int, shuffle };
}

/** Pure convenience: a deterministic shuffle of `items` for `seed`. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  return createRng(seed).shuffle(items);
}
