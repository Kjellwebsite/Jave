import type { Product } from './products';

/**
 * Rating figures derived from `rating_PLACEHOLDER`. Everything here is placeholder data from
 * the prototype and must only be rendered when `placeholdersEnabled()` is true.
 */

export interface RatingSummary {
  /** e.g. "4,8" */
  average: string;
  /** e.g. "1.284" */
  count: string;
  /** Width of the filled stars, 0 to 100. */
  starPercent: number;
}

const NUMBER = new Intl.NumberFormat('de-DE');
const ONE_DECIMAL = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function parseGermanNumber(value: string): number {
  return Number(value.replaceAll('.', '').replace(',', '.'));
}

export function starPercent(stars: number): number {
  return Math.round((stars / 5) * 1000) / 10;
}

export function productRating(product: Product): RatingSummary {
  const { avg, count } = product.rating_PLACEHOLDER;
  return { average: avg, count, starPercent: starPercent(parseGermanNumber(avg)) };
}

/** Weighted average over all products and a rounded-down total ("über 4.900"). */
export function overallRating(products: readonly Product[]): RatingSummary {
  let total = 0;
  let weighted = 0;
  for (const product of products) {
    const count = parseGermanNumber(product.rating_PLACEHOLDER.count);
    total += count;
    weighted += parseGermanNumber(product.rating_PLACEHOLDER.avg) * count;
  }
  const average = total === 0 ? 0 : Math.round((weighted / total) * 10) / 10;
  return {
    average: ONE_DECIMAL.format(average),
    count: NUMBER.format(Math.floor(total / 100) * 100),
    starPercent: starPercent(average),
  };
}

/** "Lena M." is "LM". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('');
}
