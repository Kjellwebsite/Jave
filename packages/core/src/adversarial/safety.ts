import { ValidationError } from '../kernel/errors';
import { REDACTED, redactString, truncate } from '../kernel/redact';
import {
  CREDENTIAL_NOUN,
  EXTRA_SECRET_PATTERNS,
  FILE_EXTENSIONS,
  OUT_OF_SCOPE_PATTERNS,
  PERSONAL_DATA_PATTERNS,
} from './safety-patterns';

/**
 * Safety validator for adversarial scenario content (pure, strict).
 *
 * Adversarial roles may only use fictional data, sandbox accounts and systems
 * inside an authorized trial. Every piece of text an operative acts on —
 * scenario, objective, trigger, guardrails — passes through here before it is
 * stored and again before it is authorized or briefed. When in doubt it
 * rejects: staff can always reword; a leaked credential or an off-platform
 * target cannot be undone.
 *
 * Text kinds apply different rule sets:
 * - `content`    what the operative does (scenario, objective, triggers):
 *                secrets, links, personal-data requests, out-of-scope targets.
 * - `guardrails` prohibitions for the operative: secrets, links, and the
 *                standard prohibitions must all be present. The standard
 *                prohibitions necessarily name forbidden things and are exempt
 *                from the keyword rules; every other guardrail line is briefed
 *                to the operative verbatim, so it gets the full content rules.
 * - `report`     staff write-ups (observations, evaluations, debriefs):
 *                secrets and links only.
 */

/** The only credential format a scenario may mention. It unlocks nothing outside a trial. */
export const SANDBOX_KEY_PREFIX = 'JVLN-SANDBOX-';

/**
 * The documented fictional key shape: the prefix, then one to four groups of
 * four uppercase letters or digits (e.g. JVLN-SANDBOX-7Q4M-K2XD-93PA). The bare
 * prefix is the placeholder (`JVLN-SANDBOX-…`). Anything else after the prefix
 * is treated as a possible real secret.
 */
const SANDBOX_KEY_SHAPE = /^JVLN-SANDBOX-[A-Z0-9]{4}(?:-[A-Z0-9]{4}){0,3}$/;
export const SANDBOX_KEY_EXAMPLE = 'JVLN-SANDBOX-XXXX-XXXX-XXXX';

/** Hosts a scenario may reference (and their subdomains). Changing this list is a code review. */
export const SANDBOX_DOMAINS: readonly string[] = [
  'jvln.test',
  'example.com',
  'example.org',
  'example.net',
];

/** Saying (or typing) this ends an exercise immediately. */
export const STOP_WORD = 'RED FLAG';

/** Required, verbatim, in every scenario's guardrails. Always shown in the operative briefing. */
export const STANDARD_PROHIBITIONS: readonly string[] = [
  'Use only fictional data, sandbox accounts and systems inside this trial.',
  'Never request, accept or use real credentials, passwords, tokens or 2FA codes.',
  'Never request or collect real personal data.',
  'Never involve anyone outside this trial.',
  'Never touch or link systems outside the trial sandbox.',
  'No threats, harassment or personal attacks.',
  `Stop immediately when anyone says ${STOP_WORD}.`,
];

/** Starting point for new scenarios: the standard prohibitions as a list. */
export const STANDARD_GUARDRAILS = STANDARD_PROHIBITIONS.map((line) => `- ${line}`).join('\n');

/** Texts longer than this are rejected without scanning (inputs are capped far lower). */
export const MAX_SAFETY_TEXT_LENGTH = 10_000;

const MAX_ECHO_LENGTH = 64;
const MIN_SECRET_TOKEN_LENGTH = 32;
/** Stands in for a removed standard prohibition, so words around it never join into a phrase. */
const CLAUSE_SEPARATOR = ' | ';

export type SafetyTextKind = 'content' | 'guardrails' | 'report';

export type SafetyRule =
  | 'too_long'
  | 'hidden_characters'
  | 'secret'
  | 'external_link'
  | 'personal_data'
  | 'out_of_scope'
  | 'missing_prohibition';

export interface SafetyIssue {
  field: string;
  rule: SafetyRule;
  /** Safe to show staff. Never contains a detected secret. */
  message: string;
}

export interface SafetyField {
  field: string;
  text: string;
  kind: SafetyTextKind;
}

// ─── Normalization ───────────────────────────────────────────────────────────

/** Bidi controls, zero-width and other invisible code points that can hide text. */
function isHiddenCodePoint(cp: number): boolean {
  const isC0 = cp <= 0x1f && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d;
  const isC1 = cp >= 0x7f && cp <= 0x9f;
  const isBidi =
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069) ||
    cp === 0x200e ||
    cp === 0x200f ||
    cp === 0x061c;
  const isInvisible =
    (cp >= 0x200b && cp <= 0x200d) ||
    (cp >= 0x2060 && cp <= 0x2064) ||
    cp === 0xfeff ||
    cp === 0x00ad ||
    cp === 0x180e;
  return isC0 || isC1 || isBidi || isInvisible;
}

function containsHiddenCharacters(raw: string): boolean {
  for (const char of raw) {
    if (isHiddenCodePoint(char.codePointAt(0) ?? 0)) return true;
  }
  return false;
}

function stripHiddenCharacters(raw: string): string {
  let out = '';
  for (const char of raw) {
    out += isHiddenCodePoint(char.codePointAt(0) ?? 0) ? '' : char;
  }
  return out;
}

const DEFANGED_DOT = /\s*(?:\[\s*(?:\.|dot)\s*\]|\(\s*(?:\.|dot)\s*\)|\{\s*(?:\.|dot)\s*\})\s*/gi;
const IDEOGRAPHIC_DOTS = /[。．｡]/g;
const DEFANGED_SCHEME = /\bhxxp(s?)/gi;

const WHITESPACE_RUN = /\s+/g;

/**
 * Canonical form used for inspection: compatibility-normalized (full-width →
 * ASCII), invisible characters removed, whitespace collapsed, defanged links
 * re-fanged. Case is preserved (secret shapes are case-sensitive).
 *
 * Whitespace is collapsed before DEFANGED_DOT runs: its leading `\s*` would
 * otherwise rescan every long whitespace run from each position (quadratic).
 */
export function canonicalize(raw: string): string {
  return stripHiddenCharacters(raw.normalize('NFKC'))
    .replace(WHITESPACE_RUN, ' ')
    .replace(IDEOGRAPHIC_DOTS, '.')
    .replace(DEFANGED_DOT, '.')
    .replace(DEFANGED_SCHEME, 'http$1')
    .trim();
}

// ─── Secrets ─────────────────────────────────────────────────────────────────

/** Runs of characters that can form a single credential. */
const TOKEN_RUN = /[A-Za-z0-9_+=-]+/g;

function looksLikeRandomToken(token: string): boolean {
  if (token.length < MIN_SECRET_TOKEN_LENGTH) return false;
  if (/^[0-9a-f]+$/i.test(token)) return true; // hex
  if (/^[A-Z2-7]+=*$/.test(token)) return true; // base32 (TOTP seeds)
  const hasDigit = /\d/.test(token);
  if (hasDigit && /^[A-Za-z0-9]+$/.test(token)) return true; // one unbroken alphanumeric run
  return hasDigit && /[a-z]/.test(token) && /[A-Z]/.test(token);
}

/**
 * A single token that may be a real secret: random-looking, or carrying the
 * sandbox prefix without the documented sandbox key shape (the prefix never
 * launders what follows it).
 */
function isSecretToken(token: string): boolean {
  if (token.startsWith(SANDBOX_KEY_PREFIX))
    return token !== SANDBOX_KEY_PREFIX && !SANDBOX_KEY_SHAPE.test(token);
  return looksLikeRandomToken(token);
}

function containsSecret(canonical: string): boolean {
  if (redactString(canonical) !== canonical) return true;
  if (EXTRA_SECRET_PATTERNS.some((pattern) => pattern.test(canonical))) return true;
  return (canonical.match(TOKEN_RUN) ?? []).some(isSecretToken);
}

// ─── Links & hosts ───────────────────────────────────────────────────────────

/** One DNS label, any script (internationalized domains are hosts too). */
const LABEL = '[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]{0,61}[\\p{L}\\p{N}])?';
const TOP_LABEL = '\\p{L}[\\p{L}\\p{N}-]{0,61}[\\p{L}\\p{N}]';
const HOST = `(?:${LABEL}\\.)+${TOP_LABEL}`;

const URL_WITH_SCHEME = /\b([a-z][a-z0-9+.-]{1,15}):\/\/([^\s<>"'`]+)/gi;
const DANGEROUS_SCHEME = /\b(javascript|data|vbscript|file|blob):(?=\S)/gi;
const EMAIL_DOMAIN = new RegExp(`@(${HOST})`, 'giu');
const BARE_DOMAIN = new RegExp(`(?<![\\p{L}\\p{N}_@.-])(${HOST})(?![\\p{L}\\p{N}_-])`, 'giu');

/** True when `host` is a sandbox domain or a subdomain of one. */
export function isSandboxHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, '');
  return SANDBOX_DOMAINS.some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
  );
}

function hostOf(scheme: string, rest: string): string | null {
  try {
    return new URL(`${scheme}://${rest}`).hostname;
  } catch {
    return null;
  }
}

/**
 * A host written in prose is allowed only if the name a browser would resolve
 * (IDNA/punycode form) is a sandbox host.
 */
function isSandboxName(name: string): boolean {
  const host = hostOf('http', name);
  return host !== null && isSandboxHost(host);
}

/** Offending links/hosts, in order of appearance. Hosts are safe to echo. */
function findExternalLinks(canonical: string): string[] {
  const offending: string[] = [];
  let remaining = canonical;

  for (const match of canonical.matchAll(URL_WITH_SCHEME)) {
    const scheme = (match[1] ?? '').toLowerCase();
    const host = hostOf(scheme, match[2] ?? '');
    if (scheme !== 'http' && scheme !== 'https') offending.push(`${scheme}://`);
    else if (!host) offending.push('an unparseable link');
    else if (!isSandboxHost(host)) offending.push(host);
    remaining = remaining.replace(match[0], ' ');
  }
  for (const match of remaining.matchAll(DANGEROUS_SCHEME)) {
    offending.push(`${(match[1] ?? '').toLowerCase()}:`);
  }
  for (const match of remaining.matchAll(EMAIL_DOMAIN)) {
    const domain = match[1] ?? '';
    if (!isSandboxName(domain)) offending.push(domain.toLowerCase());
    remaining = remaining.replace(match[0], ' ');
  }
  for (const match of remaining.matchAll(BARE_DOMAIN)) {
    const domain = (match[1] ?? '').toLowerCase();
    const tld = domain.slice(domain.lastIndexOf('.') + 1);
    if (FILE_EXTENSIONS.has(tld) || isSandboxName(domain)) continue;
    offending.push(domain);
  }
  return [...new Set(offending)];
}

// ─── Keyword rules ───────────────────────────────────────────────────────────

function findPhrases(lower: string, patterns: readonly RegExp[]): string[] {
  const found: string[] = [];
  for (const pattern of patterns) {
    const match = pattern.exec(lower);
    if (match) found.push(match[0].trim());
  }
  return found;
}

/** Credential nouns that are not explicitly fictional ("sandbox API key" is fine). */
function findCredentialRequests(lower: string): string[] {
  const found: string[] = [];
  for (const match of lower.matchAll(CREDENTIAL_NOUN)) {
    if (match[1] === undefined) found.push(match[0].trim());
  }
  return found;
}

interface KeywordHits {
  personalData: string[];
  outOfScope: string[];
}

function keywordHits(lower: string): KeywordHits {
  return {
    personalData: [
      ...new Set([
        ...findPhrases(lower, PERSONAL_DATA_PATTERNS),
        ...findCredentialRequests(lower),
      ]),
    ],
    outOfScope: [...new Set(findPhrases(lower, OUT_OF_SCOPE_PATTERNS))],
  };
}

/** Drops trailing dots and spaces in linear time (a `[.\s]+$` regex is quadratic on long runs). */
function trimTrailingDots(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === '.' || text[end - 1] === ' ')) end--;
  return text.slice(0, end);
}

function comparable(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(WHITESPACE_RUN, ' ');
  return trimTrailingDots(normalized).trim();
}

const COMPARABLE_PROHIBITIONS = STANDARD_PROHIBITIONS.map(comparable);

/** Standard prohibitions missing from a guardrails text. */
export function missingProhibitions(guardrails: string): string[] {
  const haystack = comparable(canonicalize(guardrails));
  return STANDARD_PROHIBITIONS.filter(
    (_clause, index) => !haystack.includes(COMPARABLE_PROHIBITIONS[index] ?? ''),
  );
}

/**
 * Everything in a guardrails text except the standard prohibitions (lower
 * case). This is operative-facing text like any objective: it gets the
 * content keyword rules.
 */
export function additionalGuardrailText(guardrails: string): string {
  let rest = comparable(canonicalize(guardrails));
  for (const clause of COMPARABLE_PROHIBITIONS) rest = rest.split(clause).join(CLAUSE_SEPARATOR);
  return rest;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Echo an offending value for staff — never one that itself looks like a secret. */
function quote(value: string): string {
  const safe = containsSecret(value) ? REDACTED : value;
  return `“${truncate(safe, MAX_ECHO_LENGTH)}”`;
}

function keywordIssues(field: string, lower: string, kind: SafetyTextKind): SafetyIssue[] {
  const hits = keywordHits(lower);
  const guardrails = kind === 'guardrails';
  const personalData = guardrails
    ? 'Guardrail lines beyond the standard prohibitions are briefed verbatim and name real personal data or credentials'
    : 'Requests real personal data or credentials';
  const outOfScope = guardrails
    ? 'Guardrail lines beyond the standard prohibitions are briefed verbatim and name something outside the trial'
    : 'Targets something outside the trial';
  const fix = guardrails
    ? 'The standard prohibitions already cover it; remove or reword the line.'
    : 'Use fictional sandbox assets inside the trial; prohibitions belong in the guardrails.';
  return [
    ...hits.personalData.map((phrase) => ({
      field,
      rule: 'personal_data' as const,
      message: `${personalData} (${quote(phrase)}). ${fix}`,
    })),
    ...hits.outOfScope.map((phrase) => ({
      field,
      rule: 'out_of_scope' as const,
      message: `${outOfScope} (${quote(phrase)}). ${fix}`,
    })),
  ];
}

/** Inspect one text. Returns every issue found (empty = safe). */
export function inspectText(field: string, raw: string, kind: SafetyTextKind): SafetyIssue[] {
  if (raw.length > MAX_SAFETY_TEXT_LENGTH) {
    return [
      { field, rule: 'too_long', message: `Text exceeds ${MAX_SAFETY_TEXT_LENGTH} characters.` },
    ];
  }
  const issues: SafetyIssue[] = [];
  const canonical = canonicalize(raw);

  if (containsHiddenCharacters(raw)) {
    issues.push({
      field,
      rule: 'hidden_characters',
      message: 'Contains invisible or direction-control characters. Retype the text.',
    });
  }
  if (containsSecret(canonical)) {
    issues.push({
      field,
      rule: 'secret',
      message: `Looks like a real secret. Use only fictional sandbox keys shaped like ${SANDBOX_KEY_EXAMPLE}.`,
    });
  }
  for (const target of findExternalLinks(canonical)) {
    issues.push({
      field,
      rule: 'external_link',
      message: `Unapproved link or domain ${quote(target)}. Only sandbox domains are allowed: ${SANDBOX_DOMAINS.join(', ')}.`,
    });
  }
  if (kind === 'content') issues.push(...keywordIssues(field, canonical.toLowerCase(), kind));
  if (kind === 'guardrails') {
    issues.push(...keywordIssues(field, additionalGuardrailText(raw), kind));
    for (const clause of missingProhibitions(raw)) {
      issues.push({
        field,
        rule: 'missing_prohibition',
        message: `Guardrails must include the standard prohibition: ${quote(clause)}`,
      });
    }
  }
  return issues;
}

/** Inspect several texts at once. */
export function inspectFields(fields: readonly SafetyField[]): SafetyIssue[] {
  return fields.flatMap((f) => inspectText(f.field, f.text, f.kind));
}

/** Throw a ValidationError listing every issue unless all fields are safe. */
export function assertSafe(fields: readonly SafetyField[]): void {
  const issues = inspectFields(fields);
  const first = issues[0];
  if (!first) return;
  throw new ValidationError(
    `Safety check failed — ${first.field}: ${first.message}`,
    issues.map((issue) => ({ path: issue.field, message: `[${issue.rule}] ${issue.message}` })),
  );
}

/**
 * Sanitize free text that must never be blocked by validation (abort reasons,
 * RED FLAG notes): a STOP always goes through. Secrets are redacted, hidden
 * characters removed, length capped.
 */
export function sanitizeStopText(raw: string, max: number): string {
  const canonical = canonicalize(raw);
  const redacted = containsSecret(canonical) ? redactString(canonical) : canonical;
  const scrubbed = redacted.replace(TOKEN_RUN, (token) => (isSecretToken(token) ? REDACTED : token));
  const cleaned = EXTRA_SECRET_PATTERNS.reduce(
    (text, pattern) => text.replace(new RegExp(pattern.source, `${pattern.flags}g`), REDACTED),
    scrubbed,
  );
  return truncate(cleaned, max);
}
