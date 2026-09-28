import { MIN_SCRUB_LENGTH } from './constants';

/**
 * Removing a person's identifiers from records the organization keeps
 * (notifications other people received, staff notes, audit context). Pure:
 * the erasure service decides where to apply it.
 */

export interface Identity {
  username: string | null;
  userDisplayName: string | null;
  memberDisplayName: string | null;
  handle: string | null;
  /** Linked accounts elsewhere (e.g. GitHub usernames). */
  otherNames: readonly string[];
}

/** Distinct identifying strings, longest first (so "Nova Lee" goes before "Nova"). */
export function scrubTerms(identity: Identity): string[] {
  const all = [
    identity.username,
    identity.userDisplayName,
    identity.memberDisplayName,
    identity.handle,
    ...identity.otherNames,
  ];
  const seen = new Map<string, string>();
  for (const value of all) {
    const term = value?.trim();
    if (term && !seen.has(term.toLowerCase())) seen.set(term.toLowerCase(), term);
  }
  return [...seen.values()].sort((a, b) => b.length - a.length);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Matches a term as a whole word: not inside a longer word or number. */
function termPattern(term: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(term)}(?![\\p{L}\\p{N}_])`, 'giu');
}

/**
 * Replace every whole-word occurrence of each term. Terms shorter than
 * MIN_SCRUB_LENGTH only replace a value that is exactly the term, so a
 * two-letter name never mangles unrelated words.
 */
export function scrubText(text: string, terms: readonly string[], replacement: string): string {
  let out = text;
  for (const term of terms) {
    if (term.length < MIN_SCRUB_LENGTH) {
      if (out.trim().toLowerCase() === term.toLowerCase()) out = replacement;
      continue;
    }
    out = out.replace(termPattern(term), replacement);
  }
  return out;
}

/** Scrub every string value in a JSON value. Keys are structure and stay as they are. */
export function scrubJson(value: unknown, terms: readonly string[], replacement: string): unknown {
  if (typeof value === 'string') return scrubText(value, terms, replacement);
  if (Array.isArray(value)) return value.map((item) => scrubJson(item, terms, replacement));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, scrubJson(item, terms, replacement)]),
    );
  }
  return value;
}

/**
 * ILIKE patterns that find candidate rows for a term: the plain text, and the
 * term as it appears inside JSON text (quotes and backslashes escaped).
 */
export function likePatterns(term: string): string[] {
  const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');
  const plain = `%${escapeLike(term)}%`;
  const json = `%${escapeLike(JSON.stringify(term).slice(1, -1))}%`;
  return plain === json ? [plain] : [plain, json];
}
