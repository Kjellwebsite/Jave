/**
 * Orientation (perspective taking). A map of natural landmarks; the respondent
 * imagines standing at one landmark facing another and names the egocentric
 * direction of a third on an 8-direction dial. Keys are placed well inside a
 * 45° sector so rounding never decides correctness.
 */
import { generatorParadigm, type LevelSpec } from '../paradigm';
import type { Rng } from '../../utils/rng';

const NAMES = ['Well', 'Oak', 'Cairn', 'Spring', 'Ridge', 'Hut', 'Pond', 'Rock', 'Ford', 'Pine'];

/** Egocentric directions, clockwise from straight ahead. Index is the key. */
export const DIRECTIONS = ['front', 'front-right', 'right', 'back-right', 'back', 'back-left', 'left', 'front-left'] as const;

const MIN_SPACING = 14;
/** The true angle must be at least this far from a sector boundary. */
const BOUNDARY_MARGIN = 12;
const LO = 6;
const HI = 94;

export interface Landmark {
  name: string;
  x: number;
  y: number;
}

export interface OrientationContent {
  landmarks: Landmark[];
  standAt: string;
  facing: string;
  target: string;
  hideMapAfterMs: number | null;
  /** Relative variant: the heading the answer refers to. */
  turnToFace: string | null;
  question: string;
}

type Pt = { x: number; y: number };

/** Clockwise bearing from map-up in degrees, [0, 360). The y axis points down. */
export function bearing(from: Pt, to: Pt): number {
  const deg = (Math.atan2(to.x - from.x, from.y - to.y) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Clockwise angle of `target` relative to the heading from `at` towards `facing`, [0, 360). */
export function egocentricAngle(at: Pt, facing: Pt, target: Pt): number {
  return (bearing(at, target) - bearing(at, facing) + 360) % 360;
}

export function directionIndex(angle: number): number {
  return Math.round(angle / 45) % 8;
}

/** Distance in degrees from the nearest sector boundary (22.5° + k·45°). */
export function boundaryMargin(angle: number): number {
  return 22.5 - Math.abs(angle - 45 * Math.round(angle / 45));
}

/** Absolute angle between a heading and map-up, 0–180. */
const offsetOf = (b: number) => Math.min(b, 360 - b);
const fromAxis = (b: number) => {
  const r = b % 90;
  return Math.min(r, 90 - r);
};
const dist = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y);
const inBounds = (p: Pt) => p.x >= LO && p.x <= HI && p.y >= LO && p.y <= HI;
const polar = (from: Pt, deg: number, r: number): Pt => {
  const rad = (deg * Math.PI) / 180;
  return { x: Math.round(from.x + r * Math.sin(rad)), y: Math.round(from.y - r * Math.cos(rad)) };
};

type Heading = 'north' | 'east-west' | 'behind' | 'oblique';

interface LevelConfig {
  level: number;
  heading: Heading;
  landmarks: number;
  hideMapAfterMs: number | null;
  relative: boolean;
}

const CONFIGS: LevelConfig[] = [
  { level: 1, heading: 'north', landmarks: 5, hideMapAfterMs: null, relative: false },
  { level: 2, heading: 'east-west', landmarks: 5, hideMapAfterMs: null, relative: false },
  { level: 3, heading: 'behind', landmarks: 6, hideMapAfterMs: null, relative: false },
  { level: 4, heading: 'oblique', landmarks: 7, hideMapAfterMs: null, relative: false },
  { level: 5, heading: 'oblique', landmarks: 6, hideMapAfterMs: 8000, relative: false },
  { level: 6, heading: 'oblique', landmarks: 6, hideMapAfterMs: 8000, relative: true },
];

function headingOk(kind: Heading, b: number): boolean {
  const off = offsetOf(b);
  switch (kind) {
    case 'north':
      return off === 0;
    case 'east-west':
      return off === 90;
    case 'behind':
      return off >= 135 && off <= 180;
    case 'oblique':
      return fromAxis(b) >= 20;
  }
}

/** Place a landmark that the observer at `at` will face, per the level's heading rule. */
function placeFacing(kind: Heading, at: Pt, rng: Rng): Pt {
  const r = rng.int(22, 50);
  switch (kind) {
    case 'north':
      return { x: at.x, y: at.y - r };
    case 'east-west':
      return { x: at.x + (rng.chance(0.5) ? r : -r), y: at.y };
    case 'behind':
      return polar(at, 180 + rng.int(-42, 42), r);
    case 'oblique':
      return polar(at, rng.int(0, 3) * 90 + rng.int(22, 68), r);
  }
}

export interface OrientationItem {
  content: OrientationContent;
  key: number;
  /** Egocentric angle of the target, degrees clockwise from the answer heading. */
  angle: number;
  facingOffset: number;
}

export function generateOrientation(level: number, rng: Rng): OrientationItem {
  const cfg = CONFIGS.find((c) => c.level === level);
  if (!cfg) throw new Error(`orientation: unknown level ${level}`);
  // Drawn once so that rejections cannot skew the key distribution.
  const key = rng.int(0, 7);
  for (let attempt = 0; attempt < 2000; attempt++) {
    const names = rng.sample(NAMES, cfg.landmarks);
    const at: Pt = { x: rng.int(LO + 8, HI - 8), y: rng.int(LO + 8, HI - 8) };
    // The heading that decides the answer: B in the plain variant, D in the relative one.
    const head = placeFacing(cfg.heading, at, rng);
    if (!inBounds(head) || dist(at, head) < MIN_SPACING) continue;
    const headBearing = bearing(at, head);
    if (!headingOk(cfg.heading, headBearing)) continue;

    let initial: Pt | null = null;
    if (cfg.relative) {
      initial = polar(at, rng.int(0, 359), rng.int(22, 50));
      if (!inBounds(initial) || dist(at, initial) < MIN_SPACING) continue;
      const turn = offsetOf((bearing(at, initial) - headBearing + 360) % 360);
      if (turn < 60) continue;
    }

    const target = polar(at, headBearing + 45 * key + rng.int(-8, 8), rng.int(20, 55));
    if (!inBounds(target)) continue;
    const angle = egocentricAngle(at, head, target);
    if (directionIndex(angle) !== key || boundaryMargin(angle) < BOUNDARY_MARGIN) continue;
    // B must not lie on the A–C line, except where C is the key "front"/"back" by design.
    if (key !== 0 && key !== 4) {
      const sep = offsetOf(angle);
      if (sep < 10 || sep > 170) continue;
    }
    // Answering from the map without rotating must not score.
    if (level >= 2 && directionIndex(bearing(at, target)) === key) continue;
    if (initial && directionIndex(egocentricAngle(at, initial, target)) === key) continue;

    const placed: Pt[] = [at, head, target, ...(initial ? [initial] : [])];
    if (!placed.every((p, i) => placed.every((q, j) => j <= i || dist(p, q) >= MIN_SPACING))) continue;
    let tries = 0;
    while (placed.length < cfg.landmarks && tries++ < 400) {
      const p = { x: rng.int(LO, HI), y: rng.int(LO, HI) };
      if (placed.every((q) => dist(p, q) >= MIN_SPACING)) placed.push(p);
    }
    if (placed.length < cfg.landmarks) continue;

    // Roles take the first names; the map order is shuffled so position carries no clue.
    const [nA, nHead, nTarget, nInitial] = names;
    const landmarks = rng.shuffle(placed.map((p, i) => ({ name: names[i], x: p.x, y: p.y })));
    const facing = cfg.relative ? nInitial : nHead;
    const question = cfg.relative
      ? `You stand at the ${nA}, facing the ${facing}. If you turned to face the ${nHead}, in which direction would the ${nTarget} be?`
      : `You stand at the ${nA}, facing the ${facing}. In which direction is the ${nTarget}?`;
    return {
      content: {
        landmarks,
        standAt: nA,
        facing,
        target: nTarget,
        hideMapAfterMs: cfg.hideMapAfterMs,
        turnToFace: cfg.relative ? nHead : null,
        question,
      },
      key,
      angle,
      facingOffset: Math.round(offsetOf(headBearing)),
    };
  }
  throw new Error(`orientation: could not generate level ${level}`);
}

export const ORIENTATION_LEVELS: LevelSpec[] = [
  { level: 1, a: 1.5, b: -1.6, c: 0.125, timeLimitMs: 45_000 },
  { level: 2, a: 1.6, b: -0.6, c: 0.125, timeLimitMs: 60_000 },
  { level: 3, a: 1.7, b: 0.4, c: 0.125, timeLimitMs: 75_000 },
  { level: 4, a: 1.7, b: 1.1, c: 0.125, timeLimitMs: 90_000 },
  { level: 5, a: 1.8, b: 2.0, c: 0.125, timeLimitMs: 105_000 },
  { level: 6, a: 1.9, b: 3.0, c: 0.125, timeLimitMs: 120_000 },
];

export const orientation = generatorParadigm<OrientationContent, number>({
  id: 'orientation',
  version: 1,
  domain: 'natural',
  group: 'core',
  experimental: true,
  facet: 'spatial-orientation',
  title: 'Orientation',
  subtitle: 'Imagine where you stand. Point to the landmark.',
  construct: 'Spatial orientation and perspective taking: locating a landmark from an imagined position and heading.',
  instructions: [
    'Imagine standing at one landmark on the map, facing another.',
    'Choose the direction of the target landmark from that point of view, not from the page.',
    'Some maps disappear after a few seconds. Memorise the layout first.',
  ],
  minutes: 4,
  minRtMs: 2500,
  levels: ORIENTATION_LEVELS,
  practiceLevels: [1, 2],
  generate(level, rng) {
    const { content, key, facingOffset } = generateOrientation(level, rng);
    return {
      content,
      key,
      response: { kind: 'choice', options: 8 },
      features: {
        facingOffset,
        landmarks: content.landmarks.length,
        hidden: content.hideMapAfterMs !== null,
        relative: content.turnToFace !== null,
      },
      explanation: `Facing the ${content.turnToFace ?? content.facing} from the ${content.standAt}, the ${content.target} is ${DIRECTIONS[key]}.`,
    };
  },
});
