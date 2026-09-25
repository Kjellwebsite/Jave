import { MAX_JSON_DEPTH } from './constants';

/**
 * Helpers for untrusted inbound JSON and text. Postgres jsonb rejects the
 * NUL character, so it is stripped before storage; nesting is bounded so
 * sanitizing cannot blow the stack.
 */

export type JsonParseResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: 'malformed_json' | 'not_an_object' | 'too_deep' };

class DepthExceeded extends Error {}

function stripNul(value: unknown, depth: number): unknown {
  if (depth > MAX_JSON_DEPTH) throw new DepthExceeded();
  if (typeof value === 'string') return value.replaceAll('\u0000', '');
  if (Array.isArray(value)) return value.map((item) => stripNul(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      // defineProperty: a "__proto__" key stays a plain data key (no prototype swap).
      Object.defineProperty(out, key.replaceAll('\u0000', ''), {
        value: stripNul(inner, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }
  return value;
}

export function parseJsonObject(raw: string): JsonParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'malformed_json' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'not_an_object' };
  }
  try {
    return { ok: true, value: stripNul(parsed, 0) as Record<string, unknown> };
  } catch (error) {
    if (error instanceof DepthExceeded) return { ok: false, reason: 'too_deep' };
    throw error;
  }
}

const WHITESPACE_RUN = /\s+/g;

/** One line of untrusted text: control characters and line breaks become spaces, bounded. */
export function cleanLine(value: string, max: number): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const control = code < 0x20 || (code >= 0x7f && code < 0xa0);
    out += control ? ' ' : char;
  }
  const collapsed = out.replace(WHITESPACE_RUN, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

/** First line of a (commit) message, cleaned. */
export function headline(value: string, max: number): string {
  return cleanLine(value.split(/\r?\n/, 1)[0] ?? '', max);
}

/**
 * Neutralize Discord mentions in untrusted text: a zero-width space after
 * every "@" and after "<#" defeats @everyone/@here, <@user>, <@&role> and
 * <#channel> parsing. The bot must still send with allowedMentions: none.
 */
export function neutralizeMentions(value: string): string {
  return value.replaceAll('@', '@​').replaceAll('<#', '<#​');
}
