import { describe, expect, it } from 'vitest';
import type { BankItem } from '../src/items/banks/content';
import { prompting, promptingItems } from '../src/items/banks/prompting';
import { reading, readingItems } from '../src/items/banks/reading';
import { semantic, semanticItems } from '../src/items/banks/semantic';
import { social, socialItems } from '../src/items/banks/social';
import { strategic, strategicItems } from '../src/items/banks/strategic';
import type { ItemParadigm } from '../src/items/paradigm';
import { createRng } from '../src/utils/rng';

const BANKS: { name: string; paradigm: ItemParadigm; items: BankItem[]; minLive: number }[] = [
  { name: 'social', paradigm: social, items: socialItems, minLive: 26 },
  { name: 'strategic', paradigm: strategic, items: strategicItems, minLive: 20 },
  { name: 'semantic', paradigm: semantic, items: semanticItems, minLive: 28 },
  { name: 'reading', paradigm: reading, items: readingItems, minLive: 20 },
  { name: 'prompting', paradigm: prompting, items: promptingItems, minLive: 18 },
];

const live = (items: BankItem[]) => items.filter((i) => !i.practice);

describe.each(BANKS)('$name bank', ({ name, paradigm, items, minLive }) => {
  it('has the expected paradigm id and enough live items', () => {
    expect(paradigm.id).toBe(name);
    expect(paradigm.kind).toBe('items');
    expect(live(items).length).toBeGreaterThanOrEqual(minLive);
    expect(paradigm.candidates([]).length).toBe(live(items).length);
  });

  it('has unique kebab-case slugs', () => {
    const slugs = items.map((i) => i.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('keys each item within range, with a consistent option count and no duplicate options', () => {
    for (const item of items) {
      const opts = item.content.options;
      expect(item.options, item.slug).toBe(opts.length);
      expect([4, 5], item.slug).toContain(opts.length);
      expect(Number.isInteger(item.key), item.slug).toBe(true);
      expect(item.key, item.slug).toBeGreaterThanOrEqual(0);
      expect(item.key, item.slug).toBeLessThan(opts.length);
      const normalized = opts.map((o) => o.trim().toLowerCase());
      expect(new Set(normalized).size, item.slug).toBe(opts.length);
      for (const o of opts) expect(o.trim().length, item.slug).toBeGreaterThan(0);
    }
  });

  it('is fully reviewed, with a rationale for every item', () => {
    for (const item of items) {
      expect(item.reviewed, item.slug).toBe(true);
      expect(item.rationale.trim().length, item.slug).toBeGreaterThan(20);
      expect(item.content.question.trim().length, item.slug).toBeGreaterThan(0);
    }
  });

  it('has exactly 2 practice items, both easier than every live item', () => {
    const practice = items.filter((i) => i.practice);
    expect(practice.length).toBe(2);
    const minLiveB = Math.min(...live(items).map((i) => i.b));
    for (const p of practice) expect(p.b).toBeLessThanOrEqual(minLiveB);
  });

  it('has facet targets covering every facet used, summing to 1', () => {
    const targets = paradigm.facetTargets ?? {};
    const used = new Set(items.map((i) => i.facet));
    for (const f of used) expect(Object.keys(targets), f).toContain(f);
    for (const f of Object.keys(targets)) expect(used.has(f), f).toBe(true);
    const sum = Object.values(targets).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThanOrEqual(0.01);
  });

  it('balances key positions (no index keyed in more than 40% of items)', () => {
    const counts = new Map<number, number>();
    for (const item of items) counts.set(item.key, (counts.get(item.key) ?? 0) + 1);
    for (const [, n] of counts) expect(n / items.length).toBeLessThanOrEqual(0.4);
  });

  it('does not make the key the longest option in more than 45% of items', () => {
    const longest = items.filter((item) => {
      const lens = item.content.options.map((o) => o.length);
      const max = Math.max(...lens);
      return lens[item.key] === max && lens.filter((l) => l === max).length === 1;
    });
    expect(longest.length / items.length).toBeLessThanOrEqual(0.45);
  });

  it('spreads difficulty, with at least 4 live items at b >= 2', () => {
    const bs = live(items).map((i) => i.b);
    expect(bs.filter((b) => b >= 2).length).toBeGreaterThanOrEqual(4);
    expect(Math.min(...bs)).toBeLessThanOrEqual(-0.5);
    for (const b of bs) {
      expect(b).toBeGreaterThanOrEqual(-2);
      expect(b).toBeLessThanOrEqual(3.5);
    }
  });

  it('instantiates live items and practice items as choice items', () => {
    for (const c of paradigm.candidates([])) {
      const item = paradigm.instantiate(c.key, createRng(1));
      expect(item.id).toBe(`${name}:${c.key}`);
      expect(item.response).toEqual({ kind: 'choice', options: (item.content as { options: string[] }).options.length });
      expect(paradigm.score(item, { kind: 'choice', index: item.key as number }).correct).toBe(true);
    }
    const practice = paradigm.practice(createRng(2), 2);
    expect(practice.length).toBe(2);
  });
});
