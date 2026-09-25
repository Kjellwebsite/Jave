import type { Rng } from './rng';

export const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

export const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : NaN);

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const a = xs.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function sd(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
}

/** Ordinary least squares slope and intercept of y on x. */
export function ols(x: number[], y: number[]): { slope: number; intercept: number } {
  const n = Math.min(x.length, y.length);
  if (n < 2) return { slope: NaN, intercept: NaN };
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
  }
  const slope = sxx ? sxy / sxx : NaN;
  return { slope, intercept: my - slope * mx };
}

/** Percentile bootstrap interval of a statistic over resampled indices. */
export function bootstrap(n: number, stat: (idx: number[]) => number, rng: Rng, reps = 1000, level = 0.9): [number, number] {
  const values: number[] = [];
  for (let r = 0; r < reps; r++) {
    const idx = Array.from({ length: n }, () => Math.floor(rng.next() * n));
    const v = stat(idx);
    if (Number.isFinite(v)) values.push(v);
  }
  values.sort((a, b) => a - b);
  if (!values.length) return [NaN, NaN];
  const lo = values[Math.floor(((1 - level) / 2) * (values.length - 1))];
  const hi = values[Math.ceil((1 - (1 - level) / 2) * (values.length - 1))];
  return [lo, hi];
}
