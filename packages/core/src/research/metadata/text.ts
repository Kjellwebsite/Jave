import { truncate } from '../../kernel/redact';

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};
const MAX_CODE_POINT = 0x10ffff;

function fromCodePoint(code: number): string {
  return Number.isInteger(code) && code > 0 && code <= MAX_CODE_POINT
    ? String.fromCodePoint(code)
    : '';
}

/** Decode the XML/HTML entities that appear in Crossref and arXiv payloads. */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return fromCodePoint(parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) return fromCodePoint(parseInt(entity.slice(1), 10));
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

const FIRST_PRINTABLE = 0x20;
const DELETE = 0x7f;

/** Replace ASCII control characters with spaces. */
function withoutControlCharacters(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    out += code < FIRST_PRINTABLE || code === DELETE ? ' ' : char;
  }
  return out;
}

/** A markup tag: `<` or `</` immediately followed by a name (so `p < 0.05` is not a tag). */
const MARKUP_TAG = /<\/?[a-z][a-z0-9:._-]*(?:\s[^<>]{0,200})?\/?>/gi;

/**
 * Plain, single-spaced text from an external field: markup tags removed
 * (e.g. JATS `<jats:p>`), then entities decoded — decoded text is kept as
 * text, so comparisons like `p &lt; 0.05` survive — control characters
 * dropped, capped.
 */
export function cleanText(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const text = withoutControlCharacters(decodeEntities(value.replace(MARKUP_TAG, ' ')))
    .replace(/\s+/g, ' ')
    .trim();
  return text ? truncate(text, max) : null;
}

/** Build YYYY-MM-DD from date parts, defaulting month/day to 01. Rejects impossible dates. */
export function isoDateFromParts(parts: readonly number[] | undefined): string | null {
  const [year, month = 1, day = 1] = parts ?? [];
  if (!year || year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return date.toISOString().slice(0, 10);
}
