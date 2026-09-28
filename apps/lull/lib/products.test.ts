import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatEuro, parseEuroCents } from './price';
import {
  allIngredients,
  distinctIngredientCount,
  getProduct,
  gradientStops,
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

  it('counts 18 distinct active ingredients, as the home page says', () => {
    expect(allIngredients()).toHaveLength(20);
    expect(distinctIngredientCount()).toBe(18);
  });

  it('prices every product below its old price', () => {
    for (const product of PRODUCTS) {
      expect(priceCents(product)).toBeLessThan(parseEuroCents(product.old_price_eur));
    }
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
