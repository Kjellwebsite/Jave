import { truncate } from '../kernel/redact';
import {
  MAX_DOI_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
  MAX_URLS_PER_MESSAGE,
  MIN_TITLE_GUESS_LENGTH,
} from './constants';

/**
 * Pure extraction of research references from free text (Discord messages):
 * DOIs, arXiv identifiers (new and old schemes), URLs with canonicalization,
 * and a best-effort title guess. No I/O.
 */

const DOI_PATTERN = /\b10\.\d{4,9}\/[^\s"'<>]+/gi;
const URL_PATTERN = /https?:\/\/[^\s<>"'`|\\^{}]+/gi;
const ARXIV_PREFIXED = /\barxiv:\s*([^\s,;]+)/gi;
/** Publisher URL suffixes that follow a DOI but are not part of it. */
const DOI_URL_SUFFIX = /\/(abstract|full|pdf|epdf|fulltext|html|meta)$/i;
const TRAILING_PUNCTUATION = /[.,;:!?'"*_`~>]$/;
const CLOSING_BRACKETS: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' };

/** arXiv new scheme (April 2007+): YYMM.NNNN (to 2014) or YYMM.NNNNN (2015+). */
const ARXIV_NEW_ID = /^(\d{2})(\d{2})\.(\d{4,5})(?:v\d+)?$/;
/** arXiv old scheme (1991–March 2007): archive(.SC)/YYMMNNN. */
const ARXIV_OLD_ID = /^([a-z]+(?:-[a-z]+)?)(?:\.([a-z]{2}))?\/(\d{2})(\d{2})(\d{3})(?:v\d+)?$/i;
const ARXIV_NEW_SCHEME_START = 704;
const ARXIV_FIVE_DIGIT_START = 1501;
const ARXIV_OLD_SCHEME_FIRST_YEAR = 91;
const ARXIV_OLD_SCHEME_LAST_YEAR = 7;

const ARXIV_HOSTS: ReadonlySet<string> = new Set([
  'arxiv.org',
  'www.arxiv.org',
  'export.arxiv.org',
]);
const DOI_HOSTS: ReadonlySet<string> = new Set(['doi.org', 'dx.doi.org', 'www.doi.org']);
const DISCORD_HOSTS: ReadonlySet<string> = new Set([
  'discord.com',
  'www.discord.com',
  'ptb.discord.com',
  'canary.discord.com',
  'discordapp.com',
  'discord.gg',
  'cdn.discordapp.com',
  'media.discordapp.net',
]);

/** Query parameters that only track clicks. `utm_*` is matched by prefix. */
const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'yclid',
  'twclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  '_hsenc',
  '_hsmi',
]);

function count(value: string, char: string): number {
  let n = 0;
  for (const c of value) if (c === char) n++;
  return n;
}

/** Strip trailing punctuation and unbalanced closing brackets (e.g. "(see 10.1/x)."). */
export function trimTrailing(value: string): string {
  let out = value;
  for (;;) {
    const last = out.at(-1);
    if (!last) return out;
    const opener = CLOSING_BRACKETS[last];
    if (TRAILING_PUNCTUATION.test(last) || (opener && count(out, opener) < count(out, last))) {
      out = out.slice(0, -1);
      continue;
    }
    return out;
  }
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/** Normalize a DOI (bare, `doi:`-prefixed or a doi.org URL). DOIs are case-insensitive. */
export function normalizeDoi(raw: string): string | null {
  let value = raw.trim().replace(/^(doi:\s*|https?:\/\/(dx\.|www\.)?doi\.org\/)/i, '');
  if (/%[0-9a-f]{2}/i.test(value)) {
    try {
      value = decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  value = trimTrailing(value).replace(DOI_URL_SUFFIX, '');
  if (!/^10\.\d{4,9}\/\S+$/i.test(value) || value.length > MAX_DOI_LENGTH) return null;
  return value.toLowerCase();
}

function doisIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(DOI_PATTERN)) {
    const doi = normalizeDoi(match[0]);
    if (doi) found.push(doi);
  }
  return found;
}

/**
 * DOIs in free text and in links. Inside a URL only the path is searched, so
 * query strings and fragments never become part of a DOI.
 */
export function extractDois(text: string): string[] {
  const inUrls = extractUrls(text).flatMap((url) => doiFromUrl(url) ?? []);
  return unique([...doisIn(text.replace(URL_PATTERN, ' ')), ...inUrls]);
}

function validMonth(mm: string): boolean {
  const month = Number(mm);
  return month >= 1 && month <= 12;
}

/** Normalize an arXiv identifier to its versionless canonical form, or null if invalid. */
export function normalizeArxivId(raw: string): string | null {
  const value = trimTrailing(raw.trim())
    .replace(/^arxiv:\s*/i, '')
    .replace(/\.pdf$/i, '');
  const modern = ARXIV_NEW_ID.exec(value);
  if (modern) {
    const [, yy = '', mm = '', sequence = ''] = modern;
    const yymm = Number(`${yy}${mm}`);
    if (!validMonth(mm) || yymm < ARXIV_NEW_SCHEME_START) return null;
    const digits = yymm >= ARXIV_FIVE_DIGIT_START ? 5 : 4;
    return sequence.length === digits ? `${yy}${mm}.${sequence}` : null;
  }
  const legacy = ARXIV_OLD_ID.exec(value);
  if (legacy) {
    const [, archive = '', subject, yy = '', mm = '', sequence = ''] = legacy;
    const year = Number(yy);
    const inRange = year >= ARXIV_OLD_SCHEME_FIRST_YEAR || year <= ARXIV_OLD_SCHEME_LAST_YEAR;
    if (!validMonth(mm) || !inRange) return null;
    const subjectClass = subject ? `.${subject.toUpperCase()}` : '';
    return `${archive.toLowerCase()}${subjectClass}/${yy}${mm}${sequence}`;
  }
  return null;
}

function parseUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** arXiv id from an arxiv.org abs/pdf/html URL. */
export function arxivIdFromUrl(raw: string): string | null {
  const url = parseUrl(raw);
  if (!url || !ARXIV_HOSTS.has(url.hostname)) return null;
  const match = /^\/(?:abs|pdf|html)\/(.+?)\/?$/.exec(url.pathname);
  return match?.[1] ? normalizeArxivId(match[1]) : null;
}

/** DOI from a doi.org URL, or embedded in a publisher URL's path (never its query). */
export function doiFromUrl(raw: string): string | null {
  const url = parseUrl(raw);
  if (!url) return null;
  if (DOI_HOSTS.has(url.hostname)) return normalizeDoi(url.pathname.slice(1));
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  return doisIn(path)[0] ?? null;
}

export function extractArxivIds(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(ARXIV_PREFIXED)) {
    const id = match[1] ? normalizeArxivId(match[1]) : null;
    if (id) found.push(id);
  }
  for (const url of extractUrls(text)) {
    const id = arxivIdFromUrl(url);
    if (id) found.push(id);
  }
  return unique(found);
}

export function hasEmbeddedCredentials(raw: string): boolean {
  const url = parseUrl(raw);
  return url !== null && (url.username !== '' || url.password !== '');
}

/** The URL without `user:password@` (credentials must never be stored or shown). */
function withoutCredentials(raw: string): string | null {
  const url = parseUrl(raw);
  if (!url) return null;
  if (!url.username && !url.password) return raw;
  url.username = '';
  url.password = '';
  return url.toString();
}

/** http(s) URLs in order of appearance, trailing punctuation and credentials removed, capped. */
export function extractUrls(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    const candidate = withoutCredentials(trimTrailing(match[0]));
    if (candidate && candidate.length <= MAX_URL_LENGTH) found.push(candidate);
    if (found.length >= MAX_URLS_PER_MESSAGE) break;
  }
  return unique(found);
}

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.startsWith('utm_') || TRACKING_PARAMS.has(lower);
}

export function isDiscordUrl(raw: string): boolean {
  const url = parseUrl(raw);
  return url !== null && DISCORD_HOSTS.has(url.hostname);
}

/**
 * Dedupe key for a URL: lowercase host, no credentials, no fragment, no
 * tracking parameters (utm_*, fbclid, gclid, …), sorted query, no trailing
 * slash. arXiv and doi.org links collapse to their identifier's canonical URL.
 * Discord links (messages, CDN attachments) are not stable references.
 */
export function canonicalizeUrl(raw: string): string | null {
  const url = parseUrl(raw);
  if (!url || DISCORD_HOSTS.has(url.hostname)) return null;
  const arxivId = arxivIdFromUrl(raw);
  if (arxivId) return `https://arxiv.org/abs/${arxivId}`;
  const doi = doiFromUrl(raw);
  if (doi) return `https://doi.org/${doi}`;
  for (const key of [...url.searchParams.keys()]) {
    if (isTrackingParam(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  const search = url.searchParams.toString();
  const path = url.pathname.replace(/\/+$/, '');
  const port = url.port ? `:${url.port}` : '';
  const canonical = `${url.protocol}//${url.hostname}${port}${path}${search ? `?${search}` : ''}`;
  return canonical.length <= MAX_URL_LENGTH ? canonical : null;
}

/** First line that reads like a title once links, identifiers and markup are removed. */
export function guessTitle(content: string): string | null {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine
      .replace(URL_PATTERN, ' ')
      .replace(DOI_PATTERN, ' ')
      .replace(ARXIV_PREFIXED, ' ')
      .replace(/\bdoi:\s*/gi, ' ')
      .replace(/<a?:\w+:\d+>/g, ' ')
      .replace(/<(@[!&]?|#)\d+>/g, ' ')
      .replace(/[*_`~>#|[\]]/g, ' ')
      .replace(/\(\s*\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[-–—:•·,;]+\s*|\s*[-–—:•·,;]+$/g, '')
      .trim();
    if (line.length >= MIN_TITLE_GUESS_LENGTH) return truncate(line, MAX_TITLE_LENGTH);
  }
  return null;
}

function titleFromFilename(filename: string): string | null {
  const base = filename
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return base.length >= MIN_TITLE_GUESS_LENGTH ? truncate(base, MAX_TITLE_LENGTH) : null;
}

/** Readable fallback title from a URL: last path segment, else the host. */
export function titleFromUrl(raw: string): string | null {
  const url = parseUrl(raw);
  if (!url) return null;
  const segment = url.pathname.split('/').filter(Boolean).at(-1);
  let decoded = segment ?? '';
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    decoded = segment ?? '';
  }
  const words = decoded
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[-_+]+/g, ' ')
    .trim();
  return truncate(words.length >= MIN_TITLE_GUESS_LENGTH ? words : url.hostname, MAX_TITLE_LENGTH);
}

export interface MessageAttachment {
  url: string;
  filename: string;
  contentType?: string;
}

export interface ResearchCandidate {
  doi: string | null;
  arxivId: string | null;
  /** Primary reference link (never a Discord message link). */
  url: string | null;
  canonicalUrl: string | null;
  titleGuess: string | null;
}

/** Everything a Discord message tells us about the reference it shares. */
export function extractResearchCandidate(
  content: string,
  attachments: readonly MessageAttachment[] = [],
): ResearchCandidate {
  const urls = extractUrls(content);
  const doi = extractDois(content)[0];
  const arxivId = extractArxivIds(content)[0];
  const reference = urls.find((u) => !isDiscordUrl(u));
  const primary =
    reference ??
    (doi ? `https://doi.org/${doi}` : arxivId ? `https://arxiv.org/abs/${arxivId}` : undefined);
  const attachment = attachments[0];
  const url = primary ?? attachment?.url ?? null;
  const titleGuess =
    guessTitle(content) ??
    (attachment ? titleFromFilename(attachment.filename) : null) ??
    (doi ? `DOI ${doi}` : arxivId ? `arXiv:${arxivId}` : primary ? titleFromUrl(primary) : null);
  return {
    doi: doi ?? null,
    arxivId: arxivId ?? null,
    url,
    canonicalUrl: primary ? canonicalizeUrl(primary) : null,
    titleGuess,
  };
}
