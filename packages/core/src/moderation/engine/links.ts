import { domainToUnicode } from 'node:url';
import { foldConfusables, skeleton, stripInvisible } from './normalize';
import { tldStrength } from './tlds';

/**
 * Pure link and Discord-invite extraction. Robust against the usual evasion:
 * defanged schemes (hxxp), bracketed dots ([.] (dot) {.}), fullwidth and
 * ideographic dots, zero-width characters inside the link, spaces around
 * dots and slashes in invites, userinfo tricks (https://discord.com@evil.com)
 * and Cyrillic/Greek lookalike letters.
 */

export interface ExtractedLink {
  /** Lowercased ASCII host (punycode for IDN), trailing dot removed. */
  host: string;
  /** Unicode form of the host, for lookalike checks and display. */
  displayHost: string;
  path: string;
  /** True when the link only appears after deobfuscation. */
  obfuscated: boolean;
}

export interface ExtractedInvite {
  code: string;
  host: string;
  obfuscated: boolean;
}

/** Discord's own domains: implicitly allowed in allowlist mode. */
export const FIRST_PARTY_DOMAINS: readonly string[] = [
  '*.discord.com',
  '*.discordapp.com',
  '*.discordapp.net',
  '*.discord.gg',
  '*.discord.gift',
  '*.discord.media',
];

/** Domains commonly imitated by phishing links. Allowlisted domains are protected too. */
export const PROTECTED_DOMAINS: readonly string[] = [
  'discord.com',
  'discord.gg',
  'discordapp.com',
  'discord.gift',
  'steamcommunity.com',
  'steampowered.com',
  'github.com',
];

const DEFANG_RULES: readonly (readonly [RegExp, string])[] = [
  [/\bh(?:xx|XX|\*\*)p(s?)(?=:|\[:\])/gi, 'http$1'],
  [/\[\s*(?:\.|dot)\s*\]|\(\s*(?:\.|dot)\s*\)|\{\s*(?:\.|dot)\s*\}/gi, '.'],
  [/[。｡]/g, '.'],
  [/\[\s*:\s*\]/g, ':'],
  [/\[\s*\/\s*\]/g, '/'],
  [/(https?):\\\\/gi, '$1://'],
];

const SCHEME_URL = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}>*_~|'"]+$/;
const BARE_DOMAIN =
  /(?<![\p{L}\p{N}@._\-/])((?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+([a-z]{2,24}))(?![\p{L}\p{N}-])((?::\d{1,5})?(?:[/?#][^\s<>"'`]*)?)/giu;
const INVITE =
  /(?<![\p{L}\p{N}_-])(?:https?:\/\/)?(?:(?:www|ptb|canary)\.)?(discord(?:app)?\.com\/invite|discord\.gg(?:\/invite)?|dsc\.gg)\/([a-z0-9-]{2,32})/giu;
const COMPACT_SEPARATORS = /[ \t]*([./])[ \t]*/g;

/** Undo common defanging and invisible splitting. Case is preserved. */
export function deobfuscate(text: string): string {
  let out = stripInvisible(text.normalize('NFKC'));
  for (const [pattern, replacement] of DEFANG_RULES) out = out.replace(pattern, replacement);
  return out;
}

function parseUrl(candidate: string): Omit<ExtractedLink, 'obfuscated'> | null {
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!host) return null;
    const unicode = domainToUnicode(host);
    return { host, displayHost: unicode || host, path: url.pathname };
  } catch {
    return null;
  }
}

/** Extract http(s) links, including bare domains, from (possibly obfuscated) text. */
export function extractLinks(text: string): ExtractedLink[] {
  const original = text.toLowerCase();
  const prepared = deobfuscate(text);
  const found = new Map<string, ExtractedLink>();
  const add = (raw: string, candidate: string) => {
    const parsed = parseUrl(candidate);
    if (!parsed) return;
    const key = `${parsed.host}${parsed.path}`;
    const obfuscated = !original.includes(raw.toLowerCase());
    const existing = found.get(key);
    if (!existing) found.set(key, { ...parsed, obfuscated });
    else if (obfuscated) existing.obfuscated = true;
  };

  for (const match of prepared.matchAll(SCHEME_URL)) {
    const raw = match[0].replace(TRAILING_PUNCTUATION, '');
    add(raw, raw);
  }
  const withoutSchemeUrls = prepared.replace(SCHEME_URL, ' ');
  for (const match of withoutSchemeUrls.matchAll(BARE_DOMAIN)) {
    const domain = match[1] ?? '';
    const tld = match[2] ?? '';
    const rest = (match[3] ?? '').replace(TRAILING_PUNCTUATION, '');
    const strength = tldStrength(tld);
    if (!strength) continue;
    if (strength === 'weak' && !/^(?::\d{1,5})?\/./.test(rest)) continue;
    const raw = `${domain}${rest}`;
    add(raw, `http://${raw}`);
  }
  return [...found.values()];
}

/** Extract Discord invite codes (discord.gg, discord.com/invite, discordapp.com/invite, dsc.gg). */
export function extractInvites(text: string): ExtractedInvite[] {
  const original = text.toLowerCase();
  const compact = foldConfusables(deobfuscate(text)).replace(COMPACT_SEPARATORS, '$1');
  const found = new Map<string, ExtractedInvite>();
  for (const match of compact.matchAll(INVITE)) {
    const host = (match[1] ?? '').toLowerCase().split('/')[0] ?? '';
    const code = match[2] ?? '';
    const obfuscated = !original.includes(match[0].toLowerCase());
    const key = `${host}/${code}`;
    const existing = found.get(key);
    if (!existing) found.set(key, { code, host, obfuscated });
    else if (obfuscated) existing.obfuscated = true;
  }
  return [...found.values()];
}

/** True when the link is a Discord invite (handled by invite rules, not link rules). */
export function isInviteLink(link: Pick<ExtractedLink, 'host' | 'path'>): boolean {
  const host = link.host.replace(/^(?:www|ptb|canary)\./, '');
  if (host === 'discord.gg' || host === 'dsc.gg') return true;
  return (host === 'discord.com' || host === 'discordapp.com') && link.path.startsWith('/invite/');
}

export type DomainListKind = 'deny' | 'allow';

/**
 * Domain pattern matching. `example.com` matches the domain and `www.`;
 * `*.example.com` also matches every subdomain. Denylist entries always
 * include subdomains (a blocked domain cannot be evaded with `x.evil.com`);
 * allowlist entries are exact unless wildcarded (fail closed).
 */
export function matchesDomainPattern(host: string, pattern: string, kind: DomainListKind): boolean {
  const normalizedHost = host.toLowerCase().replace(/\.$/, '');
  const wildcard = pattern.startsWith('*.');
  const base = (wildcard ? pattern.slice(2) : pattern).toLowerCase();
  if (normalizedHost === base || normalizedHost === `www.${base}`) return true;
  return (wildcard || kind === 'deny') && normalizedHost.endsWith(`.${base}`);
}

export function findDomainMatch(
  host: string,
  patterns: readonly string[],
  kind: DomainListKind,
): string | null {
  return patterns.find((pattern) => matchesDomainPattern(host, pattern, kind)) ?? null;
}

/**
 * Returns the protected domain a link imitates (e.g. `dlscord.gg`,
 * `discоrd.com` with a Cyrillic о), or null for genuine/unrelated hosts.
 */
export function lookalikeOf(
  link: Pick<ExtractedLink, 'host' | 'displayHost'>,
  protectedDomains: readonly string[],
): string | null {
  const genuine = protectedDomains.some(
    (domain) => link.host === domain || link.host.endsWith(`.${domain}`),
  );
  if (genuine) return null;
  const hostSkeleton = skeleton(link.displayHost.replace(/^www\./, ''));
  for (const domain of protectedDomains) {
    const target = skeleton(domain);
    if (hostSkeleton === target || hostSkeleton.endsWith(`.${target}`)) return domain;
  }
  return null;
}
