import { describe, expect, it } from 'vitest';
import { generateMatrix, MATRIX_LEVELS, predictions } from '../src/items/generators/matrix';
import { generateSeries, SERIES_LEVELS, seriesAmbiguous } from '../src/items/generators/series';
import { DEDUCTION_LEVELS, generateDeduction, linearExtensions } from '../src/items/generators/deduction';
import { createRng } from '../src/utils/rng';

describe('matrix generator', () => {
  it('generates every level with a balanced 8-option answer set', () => {
    for (const { level } of MATRIX_LEVELS) {
      for (let s = 0; s < 40; s++) {
        const { content, key } = generateMatrix(level, createRng(level * 1000 + s));
        expect(content.options).toHaveLength(8);
        expect(key).toBeGreaterThanOrEqual(0);
        expect(key).toBeLessThan(8);
        const keys = new Set(content.options.map((o) => JSON.stringify(o)));
        expect(keys.size).toBe(8);
      }
    }
  });

  it('cannot be solved from the options alone (context-blind majority solver near chance)', () => {
    let hits = 0;
    let total = 0;
    for (const { level } of MATRIX_LEVELS) {
      for (let s = 0; s < 150; s++) {
        const rng = createRng(77_000 + level * 997 + s);
        const { content, key } = generateMatrix(level, rng);
        // Score each option by how many attribute values it shares with the modal value.
        const flat = content.options.map((o) => o.flatMap((p) => [p.shape, p.size, p.shade, p.angle, p.mask]));
        const modal = flat[0].map((_, j) => {
          const counts = new Map<number, number>();
          flat.forEach((f) => counts.set(f[j], (counts.get(f[j]) ?? 0) + 1));
          return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        });
        const scores = flat.map((f) => f.filter((v, j) => v === modal[j]).length);
        const best = Math.max(...scores);
        const winners = scores.map((sc, i) => (sc === best ? i : -1)).filter((i) => i >= 0);
        if (winners.includes(key)) hits += 1 / winners.length;
        total++;
      }
    }
    // Chance is 1/8 = 0.125.
    expect(hits / total).toBeLessThan(0.2);
  });

  it('detects ambiguous rule tables', () => {
    // Progression and constant-in-row disagree on nothing here, but a table with two fitting rules should yield two predictions.
    const ambiguous = [
      [0, 1, 2],
      [0, 1, 2],
      [0, 1, 0],
    ];
    expect(predictions(ambiguous, 'scalar', 5)).toEqual(new Set([2]));
    const prog = [
      [0, 1, 2],
      [1, 2, 3],
      [2, 3, 0],
    ];
    expect(predictions(prog, 'scalar', 5)).toEqual(new Set([4]));
  });
});

describe('series generator', () => {
  it('generates unambiguous integer sequences at every level', () => {
    for (const { level } of SERIES_LEVELS) {
      for (let s = 0; s < 60; s++) {
        const { shown, answer } = generateSeries(level, createRng(level * 31 + s * 7));
        expect(shown.every(Number.isInteger)).toBe(true);
        expect(Number.isInteger(answer)).toBe(true);
        expect(seriesAmbiguous(shown, answer, level)).toBe(false);
      }
    }
  });
});

describe('deduction generator', () => {
  it('enumerates linear extensions', () => {
    expect(linearExtensions(3, [{ hi: 0, lo: 1 }])).toHaveLength(3);
    expect(linearExtensions(3, [{ hi: 0, lo: 1 }, { hi: 1, lo: 2 }])).toEqual([[0, 1, 2]]);
  });

  it('generates items with a single correct answer at every level', () => {
    for (const { level } of DEDUCTION_LEVELS) {
      for (let s = 0; s < 40; s++) {
        const { content, key } = generateDeduction(level, createRng(level * 101 + s));
        if (content.q.type === 'count') expect(key).toBeGreaterThanOrEqual(1);
        else {
          expect(key).toBeGreaterThanOrEqual(0);
          expect(key).toBeLessThan(content.q.options.length);
          expect(new Set(content.q.options).size).toBe(content.q.options.length);
        }
      }
    }
  });
});
