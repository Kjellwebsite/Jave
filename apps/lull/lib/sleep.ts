/**
 * Sleep physiology and release curves for the Drift release matrix. Everything here is
 * schematic: a typical night of a healthy adult (textbook sleep architecture), the target
 * release profile of the tablet layers and a one-compartment model of melatonin. No
 * measurements of the product.
 */

export type Stage = 'W' | 'R' | 'N1' | 'N2' | 'N3';

/** Rows of the hypnogram, top to bottom: awake, then REM, then NREM by depth. */
export const STAGES: readonly { id: Stage; label: string; long: string }[] = [
  { id: 'W', label: 'Wach', long: 'Wach' },
  { id: 'R', label: 'REM', long: 'REM-Schlaf' },
  { id: 'N1', label: 'N1', long: 'Leichtschlaf (N1)' },
  { id: 'N2', label: 'N2', long: 'Stabiler Schlaf (N2)' },
  { id: 'N3', label: 'N3', long: 'Tiefschlaf (N3)' },
];

/**
 * Reference ranges of sleep stages in healthy young adults, in percent of total sleep time
 * (Carskadon & Dement, "Normal human sleep: an overview", Principles and Practice of Sleep
 * Medicine).
 */
export const STAGE_RANGES: Record<Exclude<Stage, 'W'>, [number, number]> = {
  N1: [2, 5],
  N2: [45, 55],
  N3: [13, 23],
  R: [20, 25],
};

/** The night on the charts: lights out and intake at 22:30, alarm at 06:30. */
export const NIGHT = { start: 22 * 60 + 30, minutes: 8 * 60 } as const;

export interface Segment {
  stage: Stage;
  /** Minutes after lights out. */
  start: number;
  end: number;
}

/**
 * A typical night in five cycles of roughly 90 minutes: deep sleep (N3) in the first two
 * cycles, REM periods getting longer towards the morning, a few brief awakenings.
 */
const NIGHT_PLAN: [Stage, number][] = [
  // Cycle 1
  ['W', 14],
  ['N1', 4],
  ['N2', 14],
  ['N3', 42],
  ['N2', 8],
  ['R', 10],
  // Cycle 2
  ['N2', 16],
  ['N3', 32],
  ['N2', 22],
  ['R', 18],
  ['N1', 3],
  // Cycle 3
  ['N2', 36],
  ['N3', 14],
  ['N2', 28],
  ['R', 24],
  // Cycle 4
  ['N1', 3],
  ['N2', 64],
  ['R', 28],
  ['W', 3],
  // Cycle 5
  ['N1', 3],
  ['N2', 52],
  ['R', 30],
  ['N1', 3],
  ['W', 9],
];

export const HYPNOGRAM: readonly Segment[] = (() => {
  let start = 0;
  return NIGHT_PLAN.map(([stage, minutes]) => {
    const segment = { stage, start, end: start + minutes };
    start += minutes;
    return segment;
  });
})();

/** Stage at a minute of the night (the last segment covers the end of the night). */
export function stageAt(minute: number): Stage {
  const segment = HYPNOGRAM.find((s) => minute >= s.start && minute < s.end);
  return (segment ?? HYPNOGRAM[HYPNOGRAM.length - 1]!).stage;
}

/** Minutes per stage across the night. */
export function stageMinutes(): Record<Stage, number> {
  const minutes: Record<Stage, number> = { W: 0, R: 0, N1: 0, N2: 0, N3: 0 };
  for (const segment of HYPNOGRAM) minutes[segment.stage] += segment.end - segment.start;
  return minutes;
}

/** Share of total sleep time per sleep stage, in percent. */
export function stageShares(): Record<Exclude<Stage, 'W'>, number> {
  const minutes = stageMinutes();
  const sleep = NIGHT.minutes - minutes.W;
  const share = (stage: Exclude<Stage, 'W'>) => (minutes[stage] / sleep) * 100;
  return { N1: share('N1'), N2: share('N2'), N3: share('N3'), R: share('R') };
}

/** Clock time of a minute after lights out, e.g. `clock(90)` is "00:00". */
export function clock(minute: number): string {
  const total = Math.round(NIGHT.start + minute) % (24 * 60);
  const hours = Math.floor(total / 60);
  return `${String(hours).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * Cumulative share of a layer's actives released `hours` after intake (0 to 1), the way
 * dissolution profiles are drawn. A layer that ends within the first hour dissolves at
 * once (first order, 95 % at its end); a longer one releases along an S-curve.
 */
export function released(window: { start: number; end: number }, hours: number): number {
  const { start, end } = window;
  if (hours <= start) return 0;
  if (end - start <= 1) {
    const tau = (end - start) / 3; // 1 - e^-3 = 95 % at the end of the window
    return 1 - Math.exp(-(hours - start) / tau);
  }
  const s = clamp01((hours - start) / (end - start));
  return s * s * (3 - 2 * s);
}

/** Absorption rate constant (per hour) of oral melatonin, giving a peak after about 50 min. */
const MELATONIN_KA = 1.6;

/**
 * Plasma level of a single oral dose at `hours` after intake, relative to its peak (0 to 1).
 * One-compartment model: C(t) ~ e^(-ke t) - e^(-ka t), with ke from the half-life.
 */
export function plasmaLevel(hours: number, halfLifeMinutes: number): number {
  const ke = Math.LN2 / (halfLifeMinutes / 60);
  const ka = MELATONIN_KA;
  const curve = (t: number) => (t <= 0 ? 0 : Math.exp(-ke * t) - Math.exp(-ka * t));
  const peak = curve(Math.log(ka / ke) / (ka - ke));
  return curve(hours) / peak;
}

/** Hour of the peak of `plasmaLevel`. */
export function plasmaPeak(halfLifeMinutes: number): number {
  const ke = Math.LN2 / (halfLifeMinutes / 60);
  return Math.log(MELATONIN_KA / ke) / (MELATONIN_KA - ke);
}
