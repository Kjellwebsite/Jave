import { describe, expect, it } from 'vitest';
import { generateOrientation, orientation, ORIENTATION_LEVELS } from '../src/items/generators/orientation';
import { generateSpecimens, specimens, SPECIMENS_LEVELS, type Specimen, type SpecimenRule } from '../src/items/generators/specimens';
import { generateLayout, layout, LAYOUT_LEVELS, type LayoutElement } from '../src/items/generators/layout';
import { createRng } from '../src/utils/rng';

const SEEDS = 40;

/* ------------------------------------------------------------------ */
/* Orientation                                                          */
/* ------------------------------------------------------------------ */

/** Egocentric angle via a forward/right basis in screen coordinates (y down), clockwise degrees in [0, 360). */
function egoAngle(ax: number, ay: number, fx: number, fy: number, tx: number, ty: number): number {
  const len = Math.hypot(fx - ax, fy - ay);
  const f = { x: (fx - ax) / len, y: (fy - ay) / len };
  const r = { x: -f.y, y: f.x }; // facing up the page (0, −1) → right is (1, 0)
  const v = { x: tx - ax, y: ty - ay };
  const deg = (Math.atan2(v.x * r.x + v.y * r.y, v.x * f.x + v.y * f.y) * 180) / Math.PI;
  return (deg + 360) % 360;
}

describe('orientation generator', () => {
  it('keys the egocentric direction with a 12° boundary margin at every level', () => {
    for (const { level } of ORIENTATION_LEVELS) {
      const keys = new Set<number>();
      for (let s = 0; s < SEEDS; s++) {
        const { content, key } = generateOrientation(level, createRng(level * 1000 + s));
        const byName = new Map(content.landmarks.map((l) => [l.name, l]));
        expect(byName.size).toBe(content.landmarks.length);
        expect(content.landmarks.length).toBeGreaterThanOrEqual(5);
        expect(content.landmarks.length).toBeLessThanOrEqual(7);

        const A = byName.get(content.standAt)!;
        const B = byName.get(content.facing)!;
        const C = byName.get(content.target)!;
        const heading = content.turnToFace ? byName.get(content.turnToFace)! : B;
        expect(A && B && C && heading).toBeTruthy();
        const roles = [content.standAt, content.facing, content.target, ...(content.turnToFace ? [content.turnToFace] : [])];
        expect(new Set(roles).size).toBe(roles.length);

        for (const p of content.landmarks) {
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(100);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThanOrEqual(100);
          for (const q of content.landmarks) if (p !== q) expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(14);
        }

        const ang = egoAngle(A.x, A.y, heading.x, heading.y, C.x, C.y);
        const sector = Math.round(ang / 45) % 8;
        expect(sector).toBe(key);
        const nearestBoundary = Math.min(...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => Math.abs(ang - (22.5 + 45 * (k - 1)))));
        expect(nearestBoundary).toBeGreaterThanOrEqual(12);

        // Heading relative to map-up, via the same basis with a virtual point straight up the page.
        const offRaw = egoAngle(A.x, A.y, A.x, A.y - 10, heading.x, heading.y);
        const off = Math.min(offRaw, 360 - offRaw);
        if (level === 1) expect(off).toBeCloseTo(0, 6);
        if (level === 2) expect(off).toBeCloseTo(90, 6);
        if (level === 3) expect(off).toBeGreaterThanOrEqual(135);
        if (level >= 4) expect(Math.min(off % 90, 90 - (off % 90))).toBeGreaterThanOrEqual(20);
        if (level === 4) expect(content.landmarks).toHaveLength(7);

        expect(content.hideMapAfterMs !== null).toBe(level >= 5);
        expect(content.turnToFace !== null).toBe(level === 6);
        expect(content.question).toContain(content.standAt);
        expect(content.question).toContain(content.target);
        if (content.turnToFace) expect(content.question).toContain(content.turnToFace);
        keys.add(key);
      }
      expect(keys.size).toBeGreaterThanOrEqual(6);
    }
  });

  it('builds items through the paradigm', () => {
    for (const { level } of ORIENTATION_LEVELS) {
      const item = orientation.instantiate(String(level), createRng(9000 + level));
      expect(item.response).toEqual({ kind: 'choice', options: 8 });
      expect(item.irt.c).toBeCloseTo(0.125);
      expect(orientation.score(item, { kind: 'choice', index: item.key as number }).correct).toBe(true);
    }
    expect(orientation.experimental).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Specimens                                                            */
/* ------------------------------------------------------------------ */

const TRAIT_LIST: (keyof Specimen)[] = ['segments', 'limbPairs', 'symmetry', 'marking', 'antennae', 'tone'];

function satisfies(rule: SpecimenRule, s: Specimen): boolean {
  const v = s as unknown as Record<string, string | number>;
  if (rule.type === 'constant') return v[rule.trait] === rule.value;
  if (rule.type === 'implies') {
    const ante = rule.when.every((c) => v[c.trait] === c.value);
    return !ante || v[rule.then.trait] === rule.then.value;
  }
  if (rule.type === 'offset') return Number(v[rule.b]) - Number(v[rule.a]) === rule.k;
  const total = rule.traits.map((t) => Number(v[t])).reduce((a, b) => a + b, 0);
  return total % 2 === rule.parity;
}

const ruleTraits = (r: SpecimenRule): string[] => {
  if (r.type === 'constant') return [r.trait];
  if (r.type === 'implies') return [...r.when.map((c) => c.trait), r.then.trait];
  if (r.type === 'offset') return [r.a, r.b];
  return r.traits;
};

describe('specimens generator', () => {
  it('has exactly one rule violator, equal to the key, at every level', () => {
    for (const { level } of SPECIMENS_LEVELS) {
      for (let s = 0; s < SEEDS; s++) {
        const item = generateSpecimens(level, createRng(level * 1000 + s));
        const specs = item.specimens;
        expect(specs).toHaveLength(9);
        expect(new Set(specs.map((x) => JSON.stringify(x))).size).toBe(9);

        const violators = specs.map((x, i) => (item.rules.every((r) => satisfies(r, x)) ? -1 : i)).filter((i) => i >= 0);
        expect(violators).toEqual([item.key]);

        const anomaly = specs[item.key];
        const others = specs.filter((_, i) => i !== item.key);
        // Anomaly breaks exactly one rule (L6 has two).
        expect(item.rules.filter((r) => !satisfies(r, anomaly))).toHaveLength(1);

        // Not unique on any non-rule trait value.
        const inRule = new Set(item.rules.flatMap(ruleTraits));
        for (const t of TRAIT_LIST) {
          if (inRule.has(t)) continue;
          expect(others.some((o) => o[t] === anomaly[t])).toBe(true);
        }

        // Implications: antecedent true in at least three conforming specimens.
        for (const r of item.rules) {
          if (r.type !== 'implies') continue;
          const n = others.filter((o) => r.when.every((c) => (o as unknown as Record<string, unknown>)[c.trait] === c.value)).length;
          expect(n).toBeGreaterThanOrEqual(3);
        }

        // Noise traits vary; the number matches the reported feature.
        for (const t of item.noiseTraits) expect(inRule.has(t)).toBe(false);
        const constantTraits = TRAIT_LIST.filter((t) => !inRule.has(t) && !item.noiseTraits.includes(t));
        for (const t of constantTraits) expect(new Set(specs.map((x) => x[t])).size).toBe(1);
        expect(item.explanation.length).toBeGreaterThan(10);
      }
    }
  });

  it('builds items through the paradigm', () => {
    for (const { level } of SPECIMENS_LEVELS) {
      const item = specimens.instantiate(String(level), createRng(9100 + level));
      expect(item.response).toEqual({ kind: 'choice', options: 9 });
      expect(item.irt.c).toBeCloseTo(1 / 9);
      expect(item.features.noiseTraits).toEqual(expect.any(Number));
    }
    expect(specimens.experimental).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Layout                                                               */
/* ------------------------------------------------------------------ */

const offGrid = (e: LayoutElement) => [e.x, e.y, e.w, e.h].some((v) => v % 8 !== 0);

/** Any margin/gutter/column system under which every element's edges fall on column boundaries. */
function fitsColumns(els: LayoutElement[], width: number): boolean {
  for (let m = 8; m <= 64; m += 8)
    for (let g = 8; g <= 32; g += 8)
      for (let n = 1; n <= 6; n++) {
        const cw = (width - 2 * m - (n - 1) * g) / n;
        if (!Number.isInteger(cw) || cw <= 0) continue;
        const starts = new Set(Array.from({ length: n }, (_, i) => m + i * (cw + g)));
        const ends = new Set(Array.from({ length: n }, (_, i) => m + i * (cw + g) + cw));
        if (els.every((e) => starts.has(e.x) && ends.has(e.x + e.w))) return true;
      }
  return false;
}

describe('layout generator', () => {
  it('has exactly one off-system element, equal to the key, at every level', () => {
    for (const { level } of LAYOUT_LEVELS) {
      for (let s = 0; s < SEEDS; s++) {
        const { content, key, delta } = generateLayout(level, createRng(level * 1000 + s));
        const els = content.elements;
        expect(els.length).toBe([6, 7, 8, 9, 10, 12][level - 1]);
        expect(delta).toBe([12, 10, 6, 4, 3, 2][level - 1]);

        const off = els.map((e, i) => (offGrid(e) ? i : -1)).filter((i) => i >= 0);
        expect(off).toEqual([key]);

        const rest = els.filter((_, i) => i !== key);
        expect(fitsColumns(rest, content.width)).toBe(true);

        // Vertical rhythm among the conforming elements: row gaps take one value (a removed row may leave one wider gap).
        const tops = [...new Set(rest.map((e) => e.y))].sort((a, b) => a - b);
        const gaps = tops.slice(1).map((t, i) => t - Math.max(...rest.filter((e) => e.y === tops[i]).map((e) => e.y + e.h)));
        const counts = new Map<number, number>();
        gaps.forEach((g) => counts.set(g, (counts.get(g) ?? 0) + 1));
        const modal = Math.max(...counts.values());
        expect(gaps.length - modal).toBeLessThanOrEqual(1);

        for (let i = 0; i < els.length; i++) {
          const a = els[i];
          expect(a.x).toBeGreaterThanOrEqual(0);
          expect(a.y).toBeGreaterThanOrEqual(0);
          expect(a.x + a.w).toBeLessThanOrEqual(content.width);
          expect(a.y + a.h).toBeLessThanOrEqual(content.height);
          for (let j = i + 1; j < els.length; j++) {
            const b = els[j];
            const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
            expect(overlap).toBe(false);
          }
        }
      }
    }
  });

  it('builds items through the paradigm', () => {
    for (const { level } of LAYOUT_LEVELS) {
      const item = layout.instantiate(String(level), createRng(9200 + level));
      const n = (item.content as { elements: unknown[] }).elements.length;
      expect(item.response).toEqual({ kind: 'choice', options: n });
      expect(item.irt.c).toBeCloseTo(1 / n);
      expect(item.domain).toBe('attention');
    }
    expect(layout.group).toBe('applied');
  });
});
