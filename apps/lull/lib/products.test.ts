import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import raw from '@/data/products.json';
import { formatEuro, parseEuroCents } from './price';
import {
  allIngredients,
  distinctIngredientCount,
  getProduct,
  gradientStops,
  parseProducts,
  priceCents,
  PRODUCTS,
  productPath,
} from './products';
import { initials, overallRating, productRating, starPercent } from './ratings';

describe('product data', () => {
  it('has the five products of the design, in order', () => {
    expect(PRODUCTS.map((p) => p.slug)).toEqual(['calm', 'drift', 'spark', 'bloom', 'tide']);
  });

  it('finds products by slug', () => {
    expect(getProduct('drift')?.name).toBe('Drift');
    expect(getProduct('nope')).toBeUndefined();
    expect(getProduct(null)).toBeUndefined();
    expect(productPath(PRODUCTS[0]!)).toBe('/produkte/calm');
  });

  it('reads the five gradient stops of every product', () => {
    for (const product of PRODUCTS)
      expect(gradientStops(product.colors.bg_gradient)).toHaveLength(5);
  });

  it('counts distinct active ingredients for the home page stat', () => {
    // L-Theanin is in Calm, Drift and Spark, Safranextrakt in Calm and Bloom.
    expect(allIngredients()).toHaveLength(23);
    expect(distinctIngredientCount()).toBe(20);
  });

  it('prices every product below its old price', () => {
    for (const product of PRODUCTS) {
      expect(priceCents(product)).toBeLessThan(parseEuroCents(product.old_price_eur));
    }
  });
});

describe('flavor, explainer and warnings', () => {
  /** A copy of the real data with `edit` applied to Calm. */
  function withCalm(edit: (calm: Record<string, unknown>) => void): unknown {
    const copy = structuredClone(raw) as Record<string, unknown>[];
    edit(copy[0]!);
    return copy;
  }

  it('gives Calm its flavor, the explainer and product warnings', () => {
    const calm = getProduct('calm')!;
    expect(calm.flavor?.name).toBe('Raspberry Clouds');
    expect(calm.explainer?.eyebrow).toBe('Anti-Überreizung');
    expect(calm.warnings?.some((w) => w.includes('Alkohol'))).toBe(true);
  });

  it('warns about caffeine wherever it is an ingredient', () => {
    for (const product of PRODUCTS) {
      if (!product.ingredients.some((i) => i.name === 'Koffein')) continue;
      expect(product.warnings?.[0]).toMatch(/^Enthält Koffein \(\d+ mg pro Tablette\)\./);
    }
  });

  it('gives Drift a release matrix whose ingredients all sit in a releasing layer', () => {
    const drift = getProduct('drift')!;
    expect(drift.flavor?.scene).toBe('moon');
    expect(drift.release?.layers).toHaveLength(3);
    for (const ingredient of drift.ingredients) {
      const layer = drift.release!.layers[ingredient.layer!]!;
      expect(layer.end).toBeGreaterThan(layer.start!);
      expect(ingredient.evidence?.url).toMatch(/^https:\/\//);
    }
    expect(drift.ingredients).toHaveLength(7);
    // Animal and cell data must say that human data is missing.
    for (const ingredient of drift.ingredients.filter((i) => i.evidence?.level === 1)) {
      expect(ingredient.evidence?.finding).toMatch(/Menschen|Humandaten/);
    }
    const melatonin = drift.ingredients.find((i) => i.name === 'Melatonin')!;
    expect(melatonin.dose).toBe('1 mg');
    expect(melatonin.roles?.find((r) => r.phase === 'einschlafen')?.claim).toBe(true);
  });

  it('rejects a broken release matrix', () => {
    const withDrift = (edit: (drift: Record<string, unknown>) => void) => {
      const copy = structuredClone(raw) as Record<string, unknown>[];
      edit(copy[1]!);
      return copy;
    };
    type Release = { layers: { start?: number; end?: number }[]; halfLife: { ingredient: string } };
    expect(() =>
      parseProducts(withDrift((d) => ((d.release as Release).layers[1]!.end = 0.2))),
    ).toThrow('[1].release.layers[1]');
    expect(() =>
      parseProducts(withDrift((d) => ((d.release as Release).halfLife.ingredient = 'Glycin'))),
    ).toThrow('[1].release.halfLife.ingredient');
    expect(() =>
      parseProducts(withDrift((d) => ((d.ingredients as { layer?: number }[])[0]!.layer = 2))),
    ).toThrow('[1].ingredients[0].layer');
    expect(() =>
      parseProducts(
        withDrift(
          (d) => ((d.ingredients as { roles: { phase: string }[] }[])[0]!.roles[0]!.phase = 'x'),
        ),
      ),
    ).toThrow('[1].ingredients[0].roles[0].phase');
  });

  it('keeps the new fields optional', () => {
    const products = parseProducts(
      withCalm((calm) => {
        delete calm.flavor;
        delete calm.explainer;
        delete calm.warnings;
      }),
    );
    expect(products[0]?.flavor).toBeUndefined();
  });

  it('rejects broken entries', () => {
    expect(() =>
      parseProducts(withCalm((calm) => ((calm.flavor as { colors: string[] }).colors = ['#fff']))),
    ).toThrow('[0].flavor.colors');
    expect(() =>
      parseProducts(withCalm((calm) => ((calm.explainer as { busy: string }).busy = ' '))),
    ).toThrow('[0].explainer.busy');
    expect(() => parseProducts(withCalm((calm) => (calm.warnings = ['ok', ''])))).toThrow(
      '[0].warnings',
    );
  });
});

describe('prices', () => {
  it('parses German amounts into cents', () => {
    expect(parseEuroCents('29,90')).toBe(2990);
    expect(parseEuroCents('1.234,50')).toBe(123450);
    expect(() => parseEuroCents('29.90')).toThrow();
    expect(() => parseEuroCents('29')).toThrow();
  });

  it('formats cents back', () => {
    expect(formatEuro(2990)).toBe('29,90');
    expect(formatEuro(5580)).toBe('55,80');
    expect(formatEuro(123450)).toBe('1.234,50');
  });
});

describe('placeholder ratings', () => {
  it('derives the hero summary from all products', () => {
    expect(overallRating(PRODUCTS)).toEqual({ average: '4,7', count: '4.900', starPercent: 94 });
  });

  it('summarizes one product', () => {
    expect(productRating(PRODUCTS[0]!)).toEqual({
      average: '4,8',
      count: '1.284',
      starPercent: 96,
    });
    expect(starPercent(4)).toBe(80);
  });

  it('builds avatar initials', () => {
    expect(initials('Lena M.')).toBe('LM');
  });
});

describe('design tokens', () => {
  it('mirror the tablet colors of data/products.json', () => {
    const css = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8');
    for (const product of PRODUCTS) {
      const token = (suffix: string) =>
        new RegExp(`--color-${product.slug}${suffix}:\\s*(#[0-9a-f]{6})`, 'i').exec(css)?.[1];
      expect(token('')).toBe(product.colors.tablet_mid);
      expect(token('-deep')).toBe(product.colors.tablet_bottom);
      expect(token('-blush')).toBe(product.colors.tablet_top_blush);
    }
  });
});
