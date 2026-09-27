import { beforeAll, describe, expect, it } from 'vitest';
import { PARADIGMS, registerAll } from '../src/items';
import { PACE, pacedLimit, type ItemParadigm } from '../src/items/paradigm';
import { createRng } from '../src/utils/rng';

beforeAll(() => registerAll());

describe('every item instrument', () => {
  const items = PARADIGMS.filter((p): p is ItemParadigm => p.kind === 'items');
  for (const p of items) {
    it(`${p.id}: instantiates every level or bank item quickly and consistently`, () => {
      for (const c of p.candidates([])) {
        for (let i = 0; i < 6; i++) {
          const t0 = performance.now();
          const item = p.instantiate(c.key, createRng(i * 31 + 7));
          expect(performance.now() - t0, `${p.id} ${c.key}`).toBeLessThan(250);
          expect(item.paradigm).toBe(p.id);
          expect(item.irt.b).toBeCloseTo(c.irt.b, 6);
          // Every item has a bounded, visible time limit.
          expect(item.timeLimitMs, `${p.id} ${c.key}`).toBeGreaterThanOrEqual(PACE.minMs);
          expect(item.timeLimitMs, `${p.id} ${c.key}`).toBeLessThanOrEqual(PACE.maxMs);
          // The key must score as correct.
          const value =
            item.response.kind === 'choice'
              ? { kind: 'choice' as const, index: item.key as number }
              : item.response.kind === 'number'
                ? { kind: 'number' as const, value: item.key as number }
                : { kind: 'text' as const, value: String(item.key) };
          const control = (item.content as { control?: { key: number } }).control;
          expect(p.score(item, value, control ? { kind: 'choice', index: control.key } : undefined).correct, `${p.id} ${c.key}`).toBe(true);
        }
      }
    });
  }
});

import { validateItem } from '../src/items/schema';

describe('item validation', () => {
  it('accepts every generated and authored item', () => {
    for (const p of PARADIGMS.filter((x): x is ItemParadigm => x.kind === 'items')) {
      for (const c of p.candidates([])) {
        const item = p.instantiate(c.key, createRng(5));
        expect(validateItem(item), `${p.id} ${c.key}`).toEqual([]);
      }
    }
  });

  it('rejects malformed items', () => {
    const p = PARADIGMS.find((x) => x.id === 'matrix') as ItemParadigm;
    const good = p.instantiate('3', createRng(1));
    expect(validateItem({ ...good, key: 9 })).not.toEqual([]);
    expect(validateItem({ ...good, irt: { ...good.irt, a: -1 } })).not.toEqual([]);
    expect(validateItem({ ...good, response: { kind: 'choice', options: 1 } })).not.toEqual([]);
  });
});

describe('item pacing', () => {
  it('scales nominal limits, rounds to 5 s and clamps', () => {
    expect(pacedLimit(60_000)).toBe(45_000);
    expect(pacedLimit(90_000)).toBe(70_000);
    expect(pacedLimit(180_000)).toBe(120_000);
    expect(pacedLimit(10_000)).toBe(20_000);
    expect(pacedLimit(30_000)).toBe(25_000);
  });
});
