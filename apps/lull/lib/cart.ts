import { getProduct, priceCents } from './products';

/** Cart state is a list of (product, quantity) lines. Prices are always looked up, never stored. */

export interface CartLine {
  slug: string;
  qty: number;
}

export const MAX_QTY = 10;
export const MAX_LINES = 20;

function clampQty(qty: number): number {
  return Math.max(0, Math.min(MAX_QTY, Math.trunc(qty)));
}

export function addLine(lines: readonly CartLine[], slug: string, qty = 1): CartLine[] {
  if (!getProduct(slug)) return [...lines];
  const existing = lines.find((line) => line.slug === slug);
  if (existing) return setLineQty(lines, slug, existing.qty + qty);
  if (lines.length >= MAX_LINES) return [...lines];
  return [...lines, { slug, qty: clampQty(qty) }].filter((line) => line.qty > 0);
}

/** Quantity 0 removes the line. */
export function setLineQty(lines: readonly CartLine[], slug: string, qty: number): CartLine[] {
  return lines
    .map((line) => (line.slug === slug ? { slug, qty: clampQty(qty) } : line))
    .filter((line) => line.qty > 0);
}

export function removeLine(lines: readonly CartLine[], slug: string): CartLine[] {
  return lines.filter((line) => line.slug !== slug);
}

export function itemCount(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.qty, 0);
}

export function subtotalCents(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => {
    const product = getProduct(line.slug);
    return product ? sum + priceCents(product) * line.qty : sum;
  }, 0);
}

/**
 * Validates cart lines from an untrusted source (localStorage, a request body). Unknown
 * products, duplicates and out-of-range quantities are dropped, never trusted.
 */
export function sanitizeLines(value: unknown): CartLine[] {
  if (!Array.isArray(value)) return [];
  const lines: CartLine[] = [];
  for (const entry of value.slice(0, MAX_LINES)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { slug, qty } = entry as Record<string, unknown>;
    if (typeof slug !== 'string' || !getProduct(slug)) continue;
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) continue;
    if (lines.some((line) => line.slug === slug)) continue;
    lines.push({ slug, qty });
  }
  return lines;
}
