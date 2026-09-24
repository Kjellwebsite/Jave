import { z } from 'zod';

/**
 * Shared input building blocks for the projects and integrations modules.
 * Every free-text field is trimmed, length-capped and rejects control
 * characters (Postgres cannot store NUL; the rest only hide content).
 */

export const MAX_URL_LENGTH = 2048;

const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const FIRST_PRINTABLE = 0x20;
const DELETE = 0x7f;
const LINE_BREAKS = /[\r\n\t]/;

/** C0 controls (except tab/newlines) and DEL. */
export function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    const allowedWhitespace = code === TAB || code === LINE_FEED || code === CARRIAGE_RETURN;
    if ((code < FIRST_PRINTABLE && !allowedWhitespace) || code === DELETE) return true;
  }
  return false;
}

/** Multi-line user text (descriptions, notes). */
export function plainText(max: number, min = 0) {
  return z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !hasControlCharacters(value), 'must not contain control characters');
}

/** Single-line user text (titles, labels). */
export function singleLine(max: number, min = 1) {
  return plainText(max, min).refine((value) => !LINE_BREAKS.test(value), 'must be a single line');
}

/** True for absolute http(s) URLs with a host and no embedded credentials. */
export function isHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return (
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    parsed.hostname.length > 0 &&
    parsed.username === '' &&
    parsed.password === ''
  );
}

/** An http(s) URL, normalized by the WHATWG parser before storage. */
export const httpUrl = z
  .string()
  .trim()
  .max(MAX_URL_LENGTH)
  .refine(isHttpUrl, 'must be an http(s) URL without credentials')
  .transform((value) => new URL(value).href);

const EARLIEST_DATE = new Date('2000-01-01T00:00:00.000Z');
const LATEST_DATE = new Date('2100-01-01T00:00:00.000Z');

/** A calendar-plausible date (guards against epoch-zero and far-future garbage). */
export const plausibleDate = z.coerce
  .date()
  .refine(
    (value) => value >= EARLIEST_DATE && value < LATEST_DATE,
    'must be between 2000 and 2100',
  );

/** Escape LIKE wildcards so user search text matches literally. */
export function likePattern(search: string): string {
  return `%${search.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
}
