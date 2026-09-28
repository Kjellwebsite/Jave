/** Prices are authored as German decimal strings ("29,90") and handled as integer cents. */

const EURO = /^(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/;

/** `"29,90"` is 2990, `"1.234,50"` is 123450. Throws on anything else. */
export function parseEuroCents(value: string): number {
  const match = EURO.exec(value.trim());
  if (!match?.[1] || !match[2]) throw new Error(`Not a euro amount: "${value}"`);
  return Number(match[1].replaceAll('.', '')) * 100 + Number(match[2]);
}

const FORMAT = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 2990 is `"29,90"` (no currency sign; the design sets "€" separately). */
export function formatEuro(cents: number): string {
  return FORMAT.format(cents / 100);
}
