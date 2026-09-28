/**
 * The prototype's Park-Miller generator. Deterministic, so server and client render the same
 * particles and hydration never disagrees.
 */
export function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

export interface Mote {
  /** Percent of the field's width. */
  x: number;
  /** Percent of the field's height. */
  y: number;
  /** Diameter in px. */
  size: number;
  /** Animation delay (negative) and duration, in seconds. */
  delay: number;
  duration: number;
}

/**
 * Floating dust particles, as in the prototype (`motes`): spread over `spreadX` x `spreadY` px
 * of a field that is `fieldX` x `fieldY` px in the design, returned in percent of the field.
 */
export function motes(
  seed: number,
  count: number,
  spreadX: number,
  spreadY: number,
  fieldX = spreadX,
  fieldY = spreadY,
): Mote[] {
  const random = seededRandom(seed);
  return Array.from({ length: count }, () => ({
    x: (Math.round(random() * spreadX) / fieldX) * 100,
    y: (Math.round(random() * spreadY) / fieldY) * 100,
    size: Number((1.5 + random() * 3.5).toFixed(1)),
    delay: Number((-random() * 6).toFixed(2)),
    duration: Number((4 + random() * 5).toFixed(2)),
  }));
}
