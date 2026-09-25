/** Confidence–accuracy analysis. See docs/SCORING.md §5 and RESEARCH.md §10. */
import type { Session } from '../types';
import { createRng, hashSeed } from '../utils/rng';
import { bootstrap, mean } from '../utils/stats';

export interface MetaReport {
  n: number;
  sufficient: boolean;
  meanConfidence: number;
  accuracy: number;
  bias: number;
  biasCi: [number, number];
  brier: number;
  reliability: number;
  resolution: number;
  uncertainty: number;
  auroc: number;
  aurocCi: [number, number];
  label: { calibration: string; discrimination: string };
  /** Calibration curve: mean confidence and accuracy per 0.1 bin. */
  curve: { confidence: number; accuracy: number; n: number }[];
}

export function auroc2(conf: number[], correct: boolean[]): number {
  const hits = conf.filter((_, i) => correct[i]);
  const misses = conf.filter((_, i) => !correct[i]);
  if (!hits.length || !misses.length) return NaN;
  let s = 0;
  for (const a of hits) for (const b of misses) s += a > b ? 1 : a === b ? 0.5 : 0;
  return s / (hits.length * misses.length);
}

/** Murphy (1973) decomposition over confidence bins. */
export function brierDecomposition(conf: number[], out: number[]) {
  const n = conf.length;
  const base = mean(out);
  const bins = new Map<number, { c: number[]; o: number[] }>();
  conf.forEach((c, i) => {
    const k = Math.min(9, Math.floor(c * 10));
    const b = bins.get(k) ?? { c: [], o: [] };
    b.c.push(c);
    b.o.push(out[i]);
    bins.set(k, b);
  });
  let reliability = 0;
  let resolution = 0;
  const curve: MetaReport['curve'] = [];
  for (const [, b] of [...bins.entries()].sort((x, y) => x[0] - y[0])) {
    const mc = mean(b.c);
    const mo = mean(b.o);
    reliability += (b.c.length / n) * (mc - mo) ** 2;
    resolution += (b.c.length / n) * (mo - base) ** 2;
    curve.push({ confidence: mc, accuracy: mo, n: b.c.length });
  }
  const brier = mean(conf.map((c, i) => (c - out[i]) ** 2));
  return { brier, reliability, resolution, uncertainty: base * (1 - base), curve };
}

export function metacognition(session: Session): MetaReport {
  const rated = session.sections.flatMap((s) => s.responses).filter((r) => typeof r.confidence === 'number' && !r.rapid);
  const conf = rated.map((r) => r.confidence!);
  const correct = rated.map((r) => r.correct);
  const out = correct.map((c) => (c ? 1 : 0));
  const n = rated.length;
  const nCorrect = out.filter(Boolean).length;
  const sufficient = n >= 12 && nCorrect >= 3 && n - nCorrect >= 3;
  const rng = createRng(hashSeed(session.seed, 'meta'));
  const biasOf = (idx: number[]) => mean(idx.map((i) => conf[i])) - mean(idx.map((i) => out[i]));
  const aurocOf = (idx: number[]) => auroc2(idx.map((i) => conf[i]), idx.map((i) => correct[i]));
  const dec = n ? brierDecomposition(conf, out) : { brier: NaN, reliability: NaN, resolution: NaN, uncertainty: NaN, curve: [] };
  const bias = n ? mean(conf) - mean(out) : NaN;
  const biasCi = sufficient ? bootstrap(n, biasOf, rng.fork('bias')) : ([NaN, NaN] as [number, number]);
  const auroc = aurocOf(rated.map((_, i) => i));
  const aurocCi = sufficient ? bootstrap(n, aurocOf, rng.fork('auroc')) : ([NaN, NaN] as [number, number]);
  const calibration = !sufficient
    ? 'Insufficient data'
    : biasCi[0] > 0
      ? 'Overconfident'
      : biasCi[1] < 0
        ? 'Underconfident'
        : 'Well calibrated';
  const discrimination = !sufficient ? 'Insufficient data' : aurocCi[0] > 0.5 ? 'Confidence discriminates' : 'No reliable discrimination';
  return {
    n,
    sufficient,
    meanConfidence: n ? mean(conf) : NaN,
    accuracy: n ? mean(out) : NaN,
    bias,
    biasCi,
    ...dec,
    auroc,
    aurocCi,
    label: { calibration, discrimination },
  };
}
