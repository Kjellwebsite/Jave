import { ValidationError } from '../kernel/errors';
import { REDACTED, redactString, truncate } from '../kernel/redact';

/**
 * Safety validator for adversarial scenario content (pure, strict).
 *
 * Adversarial roles may only use fictional data, sandbox accounts and systems
 * inside an authorized trial. Every piece of text an operative acts on —
 * scenario, objective, trigger — passes through here before it is stored and
 * again before it is authorized or briefed. When in doubt it rejects: staff
 * can always reword; a leaked credential or an off-platform target cannot be
 * undone.
 *
 * Text kinds apply different rule sets:
 * - `content`    what the operative does (scenario, objective, triggers):
 *                secrets, links, personal-data requests, out-of-scope targets.
 * - `guardrails` prohibitions for the operative: secrets, links, and the
 *                standard prohibitions must all be present. Prohibitions
 *                necessarily name forbidden things, so the content keyword
 *                rules do not apply.
 * - `report`     staff write-ups (observations, evaluations, debriefs):
 *                secrets and links only.
 */

/** The only credential format a scenario may mention. It unlocks nothing outside a trial. */
export const SANDBOX_KEY_PREFIX = 'JVLN-SANDBOX-';

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

/** Credential shapes beyond the kernel redaction patterns. Built not to match sandbox keys. */
const EXTRA_SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, // AWS access key id
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/, // Slack
  /\bAIza[0-9A-Za-z_-]{35}\b/, // Google API key
  /\b[rsp]k_(?:live|test)_[0-9A-Za-z]{10,}/, // Stripe
  /\b(?:glpat-|npm_|pypi-)[A-Za-z0-9_-]{20,}/, // GitLab / npm / PyPI
  /\bhttps?:\/\/[^\s/:@]+:[^\s/@]+@/i, // credentials embedded in a URL
  /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|token)\s*[:=]\s*["']?(?!JVLN-SANDBOX-)[^\s"']{6,}/i,
  /\bbearer\s+(?!JVLN-SANDBOX-)[A-Za-z0-9._~+/-]{16,}/i,
];

function looksLikeRandomToken(token: string): boolean {
  if (token.length < MIN_SECRET_TOKEN_LENGTH) return false;
  if (/^[0-9a-f]+$/i.test(token)) return true;
  return /\d/.test(token) && /[a-z]/.test(token) && /[A-Z]/.test(token);
}

function containsSecret(canonical: string): boolean {
  if (redactString(canonical) !== canonical) return true;
  if (EXTRA_SECRET_PATTERNS.some((pattern) => pattern.test(canonical))) return true;
  return canonical
    .split(/[^A-Za-z0-9_+=-]+/)
    .some((token) => !token.startsWith(SANDBOX_KEY_PREFIX) && looksLikeRandomToken(token));
}

// ─── Links & hosts ───────────────────────────────────────────────────────────

/** Tokens like `notes.md` look like domains; these extensions are not TLDs. */
const FILE_EXTENSIONS = new Set([
  'csv',
  'css',
  'docx',
  'gif',
  'html',
  'jpeg',
  'jpg',
  'js',
  'json',
  'jsx',
  'lock',
  'log',
  'pdf',
  'png',
  'pptx',
  'sql',
  'svg',
  'toml',
  'ts',
  'tsx',
  'txt',
  'xlsx',
  'yaml',
  'yml',
]);

const URL_WITH_SCHEME = /\b([a-z][a-z0-9+.-]{1,15}):\/\/([^\s<>"'`]+)/gi;
const DANGEROUS_SCHEME = /\b(javascript|data|vbscript|file|blob):(?=\S)/gi;
const EMAIL_DOMAIN = /@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi;
const BARE_DOMAIN =
  /(?<![\w@.-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9])(?![\w-])/gi;

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
    if (!isSandboxHost(domain)) offending.push(domain.toLowerCase());
    remaining = remaining.replace(match[0], ' ');
  }
  for (const match of remaining.matchAll(BARE_DOMAIN)) {
    const domain = (match[1] ?? '').toLowerCase();
    const tld = domain.slice(domain.lastIndexOf('.') + 1);
    if (FILE_EXTENSIONS.has(tld) || isSandboxHost(domain)) continue;
    offending.push(domain);
  }
  return [...new Set(offending)];
}

// ─── Content keyword rules ───────────────────────────────────────────────────

/** Requests for real personal data. Applied to `content` only (matched on lowercase text). */
const PERSONAL_DATA_PATTERNS: readonly RegExp[] = [
  /\bpass(?:word|phrase|code)s?\b/,
  /\bpasswd\b/,
  /\b(?:2fa|mfa|two[- ]?factor|multi[- ]?factor|otp|totp)\b/,
  /\bone[- ]time (?:pass(?:word|code)?s?|codes?|pins?)\b/,
  /\b(?:verification|authentication|authenticator|auth|login|sign[- ]?in|security|backup|recovery) codes?\b/,
  /\b(?:ssn|social security|national insurance|national id|passport|driver'?s licen[cs]e|tax id)\b/,
  /\b(?:bank|banking|iban|swift code|routing number|sort code|credit card|debit card|card number|cvv|cvc|pin (?:code|number))s?\b/,
  /\b(?:home|street|mailing|postal|billing|ip) address(?:es)?\b/,
  /\b(?:real|personal|private|actual) (?:accounts?|e-?mails?|phones?|phone numbers?|names?|identit(?:y|ies)|address(?:es)?|credentials?|logins?|data|details|information|info|photos?|messages?)\b/,
  /\b(?:full|legal|last) names?\b|\bsurnames?\b/,
  /\b(?:date of birth|birth ?date|dob)\b/,
  /\b(?:phone|mobile|cell) numbers?\b/,
  /\b(?:medical|health) (?:records?|data|information|history)\b/,
  /\b(?:seed|recovery|mnemonic) phrases?\b/,
  /\b(?:private|wallet) keys?\b/,
  /\bsession (?:cookies?|tokens?)\b/,
];

/** Targets outside the trial: real systems, real people, off-platform accounts, malware. */
const OUT_OF_SCOPE_PATTERNS: readonly RegExp[] = [
  /\b(?:production|prod)\b/,
  /\b(?:real|actual|live) (?:systems?|servers?|databases?|db|environments?|infrastructure|networks?|repos?|repositories|services?|apps?|applications?|websites?|sites?|customers?|clients?|users?|compan(?:y|ies)|organi[sz]ations?|people|persons?|members?|staff|money|payments?|funds)\b/,
  /\b(?:outside|beyond) (?:of )?(?:the |this )?(?:trial|sandbox|exercise|team|server|guild)\b/,
  /\b(?:external|third[- ]party) (?:systems?|services?|servers?|sites?|websites?|platforms?|accounts?|apis?|tools?|drives?)\b/,
  /\b(?:school|work|employer|university|college|company|corporate|office|government) (?:accounts?|e-?mails?|networks?|systems?|laptops?|devices?|logins?|servers?|drives?|data)\b/,
  /\b(?:own|personal|home) (?:computers?|laptops?|phones?|devices?|machines?|networks?|routers?|wi-?fi)\b/,
  /\b(?:malware|ransomware|keyloggers?|trojans?|spyware|rootkits?|botnets?|backdoors?|virus(?:es)?|cryptominers?)\b/,
  /\b(?:ddos|dos attacks?|denial[- ]of[- ]service|port ?scan(?:s|ning)?|brute[- ]?forc(?:e|ing))\b/,
  /\b(?:phishing (?:pages?|sites?|links?|kits?|e-?mails?)|credential harvest(?:ing|ers?)?)\b/,
  /\b(?:discord|github|gitlab|google|gmail|apple|icloud|microsoft|outlook|steam|twitter|instagram|tiktok|facebook|meta|linkedin|reddit|twitch|paypal|venmo|revolut|coinbase|binance|slack|notion|dropbox|onedrive|aws|azure|gcp) (?:accounts?|logins?|passwords?|credentials?|tokens?|ids?|sessions?|2fa|cookies?|keys?|nitro|gifts?)\b/,
  /\b(?:friends|family|parents|relatives|classmates|co-?workers|colleagues|teachers|employers?|neighbou?rs|strangers|non[- ]?participants?)\b/,
  /\blocalhost\b/,
  /(?:^|[^\w.])(?:\d{1,3}\.){3}\d{1,3}(?!\.?\d)(?!\w)/,
  /<@[!&]?\d{15,22}>/,
  /@(?:everyone|here)\b/,
];

function findPhrases(lower: string, patterns: readonly RegExp[]): string[] {
  const found: string[] = [];
  for (const pattern of patterns) {
    const match = pattern.exec(lower);
    if (match) found.push(match[0].trim());
  }
  return [...new Set(found)];
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

/** Standard prohibitions missing from a guardrails text. */
export function missingProhibitions(guardrails: string): string[] {
  const haystack = comparable(canonicalize(guardrails));
  return STANDARD_PROHIBITIONS.filter((clause) => !haystack.includes(comparable(clause)));
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Echo an offending value for staff — never one that itself looks like a secret. */
function quote(value: string): string {
  const safe = containsSecret(value) ? REDACTED : value;
  return `“${truncate(safe, MAX_ECHO_LENGTH)}”`;
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
  const lower = canonical.toLowerCase();

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
      message: `Looks like a real secret. Use only fictional sandbox keys (${SANDBOX_KEY_PREFIX}…).`,
    });
  }
  for (const target of findExternalLinks(canonical)) {
    issues.push({
      field,
      rule: 'external_link',
      message: `Unapproved link or domain ${quote(target)}. Only sandbox domains are allowed: ${SANDBOX_DOMAINS.join(', ')}.`,
    });
  }
  if (kind === 'content') {
    for (const phrase of findPhrases(lower, PERSONAL_DATA_PATTERNS)) {
      issues.push({
        field,
        rule: 'personal_data',
        message: `Requests real personal data (${quote(phrase)}). Use fictional sandbox assets; put prohibitions in the guardrails.`,
      });
    }
    for (const phrase of findPhrases(lower, OUT_OF_SCOPE_PATTERNS)) {
      issues.push({
        field,
        rule: 'out_of_scope',
        message: `Targets something outside the trial (${quote(phrase)}). Scenarios stay inside the trial sandbox.`,
      });
    }
  }
  if (kind === 'guardrails') {
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
  const scrubbed = redacted
    .split(/\s+/)
    .map((token) =>
      !token.startsWith(SANDBOX_KEY_PREFIX) && looksLikeRandomToken(token) ? REDACTED : token,
    )
    .join(' ');
  const cleaned = EXTRA_SECRET_PATTERNS.reduce(
    (text, pattern) => text.replace(new RegExp(pattern.source, `${pattern.flags}g`), REDACTED),
    scrubbed,
  );
  return truncate(cleaned, max);
}
