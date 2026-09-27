/**
 * Chart geometry — pure helpers shared by the chart primitives.
 *
 * Colour roles (validated with the data-viz palette checks against the
 * JAVELIN surfaces, dark `surface` #0E0F11 and light #FFFFFF):
 * - single series: `fg-muted` (10:1 on both surfaces); hover lifts to `fg`
 * - second series of a polarity pair (e.g. leaves under joins): `neutral-500`
 *   (steel, 4.4:1 on both), drawn on the other side of the baseline
 * - ordinal three-step (VERIFIED › CLAIMED › UNKNOWN): `fg` › `fg-subtle` ›
 *   `fg-faint` (monotone, ≥ 0.06 ΔL per step, faint end ≥ 2.6:1)
 * - sequential (heat cells): `fg` mixed into the surface by intensity
 * - gridlines `line-subtle`, baselines `line-strong`, text only in text tokens
 */

/** Tick steps tried per power of ten, smallest first. */
const NICE_FACTORS = [1, 2, 2.5, 5, 10] as const;
const DEFAULT_TICK_COUNT = 3;
const PERCENT = 100;
/** A missing point's band reaches half a step to each side. */
const HALF_STEP = 0.5;

export interface NiceScale {
  /** Top of the axis (≥ the data maximum). */
  max: number;
  /** Tick values from 0 to `max`, inclusive. */
  ticks: number[];
}

/** A "nice" step for `raw` (1, 2, 2.5, 5 × 10ⁿ). Integer data never gets fractional steps. */
export function niceStep(raw: number, integer = true): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  if (integer && raw <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  for (const factor of NICE_FACTORS) {
    const step = factor * magnitude;
    if (step < raw) continue;
    if (integer && !Number.isInteger(step)) continue;
    return integer ? Math.max(1, step) : step;
  }
  return 10 * magnitude;
}

/** Zero-based axis with about `tickCount` intervals that covers `maxValue`. */
export function niceScale(maxValue: number, tickCount = DEFAULT_TICK_COUNT): NiceScale {
  const safeMax = Number.isFinite(maxValue) && maxValue > 0 ? maxValue : 0;
  const step = niceStep(safeMax / Math.max(1, tickCount));
  const max = safeMax === 0 ? step : Math.ceil(safeMax / step) * step;
  const ticks: number[] = [];
  for (let tick = 0; tick <= max; tick += step) ticks.push(tick);
  return { max, ticks };
}

/** `value` as a percentage of `max`, clamped to [0, 100]; 0 when max is not positive. */
export function percentOf(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(PERCENT, Math.max(0, (value / max) * PERCENT));
}

/** A 0–1 rate as "42%" (whole percent), or an em dash when unknown. */
export function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return '—';
  return `${Math.round(rate * PERCENT)}%`;
}

/** Index of the data slot under `offset` in a plot `width` wide holding `count` slots. */
export function slotIndex(offset: number, width: number, count: number): number | null {
  if (count <= 0 || width <= 0 || !Number.isFinite(offset)) return null;
  const index = Math.floor((offset / width) * count);
  return Math.min(count - 1, Math.max(0, index));
}

/** Index of the nearest point when `count` points sit on a line from 0 to `width`. */
export function pointIndex(offset: number, width: number, count: number): number | null {
  if (count <= 0 || width <= 0 || !Number.isFinite(offset)) return null;
  if (count === 1) return 0;
  const index = Math.round((offset / width) * (count - 1));
  return Math.min(count - 1, Math.max(0, index));
}

/** Horizontal position (0–100) of point `index` of `count` on a line chart. */
export function pointX(index: number, count: number): number {
  if (count <= 1) return PERCENT / 2;
  return (index / (count - 1)) * PERCENT;
}

/**
 * The band (left and width, 0–100) a missing point shades on a line chart:
 * half a step either side of it, clipped to the plot. Neighbouring gaps meet
 * edge to edge, so a run of missing days reads as one band.
 */
export function gapBand(index: number, count: number): { left: number; width: number } {
  if (count <= 1) return { left: 0, width: PERCENT };
  const step = PERCENT / (count - 1);
  const left = Math.max(0, (index - HALF_STEP) * step);
  const right = Math.min(PERCENT, (index + HALF_STEP) * step);
  return { left, width: Math.max(0, right - left) };
}

/**
 * SVG path data for a line through `values` in a (count−1) × 100 box, y
 * inverted (0 at the bottom). Gaps (`null`) break the line; a lone point
 * between gaps produces no segment (callers mark it with a dot).
 */
export function linePaths(values: readonly (number | null)[], max: number): string[] {
  const top = max > 0 ? max : 1;
  const paths: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 1) paths.push(current.join(' '));
    current = [];
  };
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      flush();
      return;
    }
    const y = PERCENT - percentOf(value, top);
    current.push(`${current.length === 0 ? 'M' : 'L'}${index} ${y}`);
  });
  flush();
  return paths;
}

/** Closed area paths under each line segment (the 10 % wash). */
export function areaPaths(values: readonly (number | null)[], max: number): string[] {
  const top = max > 0 ? max : 1;
  const areas: string[] = [];
  let run: { index: number; y: number }[] = [];
  const flush = () => {
    if (run.length > 1) {
      const first = run[0]!;
      const last = run[run.length - 1]!;
      const line = run.map((p) => `L${p.index} ${p.y}`).join(' ');
      areas.push(`M${first.index} ${PERCENT} ${line} L${last.index} ${PERCENT} Z`);
    }
    run = [];
  };
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      flush();
      return;
    }
    run.push({ index, y: PERCENT - percentOf(value, top) });
  });
  flush();
  return areas;
}

export interface DivergingLayout {
  /** Axis maximum above the baseline. */
  upMax: number;
  /** Axis maximum below the baseline. */
  downMax: number;
  /** Share of the plot height above the baseline (0–1). */
  baseline: number;
}

/**
 * One shared scale for a polarity pair (e.g. joins above, leaves below) so
 * equal counts draw equal lengths on both sides of the baseline.
 */
export function divergingLayout(
  up: readonly (number | null)[],
  down: readonly (number | null)[],
): DivergingLayout {
  const peak = (values: readonly (number | null)[]) =>
    values.reduce<number>((max, value) => (value !== null && value > max ? value : max), 0);
  const upPeak = peak(up);
  const downPeak = peak(down);
  if (upPeak === 0 && downPeak === 0) return { upMax: 1, downMax: 1, baseline: 0.5 };
  const upMax = upPeak === 0 ? 0 : niceScale(upPeak).max;
  const downMax = downPeak === 0 ? 0 : niceScale(downPeak).max;
  return { upMax, downMax, baseline: upMax / (upMax + downMax) };
}

/** Heat intensity (0–1) for a cell; a non-zero count is never invisible. */
export const MIN_HEAT = 0.08;
export function heatIntensity(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0 || max <= 0) return 0;
  return MIN_HEAT + (1 - MIN_HEAT) * Math.min(1, value / max);
}

/** Above this intensity a heat cell switches its text to the inverse ink. */
export const HEAT_INVERSE_TEXT_AT = 0.55;
