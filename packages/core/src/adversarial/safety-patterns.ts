/**
 * Pattern tables for the safety validator (safety.ts). Keyword patterns are
 * matched against the canonical, lower-cased text with whitespace collapsed
 * to single spaces.
 */

/** Credential shapes beyond the kernel redaction patterns. Built not to match sandbox keys. */
export const EXTRA_SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, // AWS access key id
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/, // Slack
  /\bAIza[0-9A-Za-z_-]{35}\b/, // Google API key
  /\b[rsp]k_(?:live|test)_[0-9A-Za-z]{10,}/, // Stripe
  /\b(?:glpat-|npm_|pypi-)[A-Za-z0-9_-]{20,}/, // GitLab / npm / PyPI
  /\bhttps?:\/\/[^\s/:@]+:[^\s/@]+@/i, // credentials embedded in a URL
  /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|token)\s*[:=]\s*["']?(?!JVLN-SANDBOX-)[^\s"']{6,}/i,
  /\bbearer\s+(?!JVLN-SANDBOX-)[A-Za-z0-9._~+/-]{16,}/i,
];

/** Tokens like `notes.md` look like domains; these extensions are not TLDs. */
export const FILE_EXTENSIONS: ReadonlySet<string> = new Set([
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

/** Requests for real personal data and real authentication factors. */
export const PERSONAL_DATA_PATTERNS: readonly RegExp[] = [
  /\bpass(?:word|phrase|code)s?\b/,
  /\bpasswd\b/,
  /\b(?:2fa|mfa|two[- ]?factor|multi[- ]?factor|otp|totp)\b/,
  /\bone[- ]time (?:pass(?:word|code)?s?|codes?|pins?)\b/,
  /\b(?:verification|authentication|auth|login|log-in|sign[- ]?in|security|backup|recovery|confirmation|sms|text) codes?\b/,
  /\bauthenticator\b/,
  /\b(?:\d+|four|five|six|seven|eight) ?-?digits?\b/,
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
  /\bsession (?:cookies?|tokens?|ids?)\b/,
];

/**
 * Credential nouns on their own. Allowed only when explicitly fictional
 * (captured qualifier, e.g. "sandbox API key"); every other occurrence is a
 * request for a real credential. Global: every occurrence is checked.
 */
export const CREDENTIAL_NOUN =
  /\b(?:(sandbox|fictional|fake|dummy) )?(?:(?:personal )?access tokens?|api[ -]?keys?|auth(?:entication)? tokens?|refresh tokens?|bearer tokens?|ssh keys?|secret keys?|client secrets?|credentials?|log-?ins?|log-?in (?:details|info(?:rmation)?|data|names?)|sign-?in details|user ?names?)\b/g;

/** Targets outside the trial: real systems, real people, off-platform services, malware. */
export const OUT_OF_SCOPE_PATTERNS: readonly RegExp[] = [
  /\b(?:production|prod)\b/,
  /\b(?:real|actual|live) (?:systems?|servers?|databases?|db|environments?|infrastructure|networks?|repos?|repositories|services?|apps?|applications?|websites?|sites?|customers?|clients?|users?|compan(?:y|ies)|organi[sz]ations?|people|persons?|members?|staff|money|payments?|funds)\b/,
  /\b(?:outside|beyond) (?:of )?(?:the |this )?(?:trial|sandbox|exercise|team|server|guild)\b/,
  /\b(?:external|third[- ]party) (?:systems?|services?|servers?|sites?|websites?|platforms?|accounts?|apis?|tools?|drives?)\b/,
  /\b(?:school|work|employer|university|college|company|corporate|office|government) (?:accounts?|e-?mails?|networks?|systems?|laptops?|devices?|logins?|servers?|drives?|data)\b/,
  /\b(?:own|personal|home) (?:computers?|laptops?|phones?|devices?|machines?|networks?|routers?|wi-?fi)\b/,
  /\b(?:their|his|her|someone'?s|teammates?'?s?|participants?'?s?) (?:own )?(?:accounts?|inbox(?:es)?|phones?|devices?|computers?|laptops?)\b/,
  /\b(?:malware|ransomware|keyloggers?|trojans?|spyware|rootkits?|botnets?|backdoors?|virus(?:es)?|cryptominers?)\b/,
  /\b(?:ddos|dos attacks?|denial[- ]of[- ]service|port ?scan(?:s|ning)?|brute[- ]?forc(?:e|ing))\b/,
  /\b(?:phishing (?:pages?|sites?|links?|kits?|e-?mails?)|credential harvest(?:ing|ers?)?)\b/,
  /\b(?:discord|github|gitlab|google|gmail|apple|icloud|microsoft|outlook|steam|twitter|instagram|tiktok|facebook|meta|linkedin|reddit|twitch|paypal|venmo|revolut|coinbase|binance|slack|notion|dropbox|onedrive|aws|azure|gcp) (?:accounts?|logins?|passwords?|credentials?|tokens?|ids?|sessions?|2fa|cookies?|keys?|nitro|gifts?)\b/,
  // Off-platform storage, mail and messaging. Sandbox hosts are links, checked separately.
  /\b(?:google ?drive|gdrive|google (?:docs?|sheets?|slides|forms?)|dropbox|one ?drive|icloud|wetransfer|pastebin|hastebin|github gists?|sharepoint|gmail|hotmail|yahoo|proton ?mail|telegram|whatsapp|imessage|snapchat|wechat|s3 buckets?|usb (?:sticks?|drives?|keys?)|thumb ?drives?|flash drives?|cloud (?:storage|drives?|accounts?|folders?)|file[- ]sharing (?:sites?|services?))\b/,
  /\b(?:friends|family|parents|relatives|classmates|co-?workers|colleagues|teachers|employers?|neighbou?rs|strangers|non[- ]?participants?)\b/,
  /\blocalhost\b/,
  /(?:^|[^\w.])(?:\d{1,3}\.){3}\d{1,3}(?!\.?\d)(?!\w)/,
  /<@[!&]?\d{15,22}>/,
  /@(?:everyone|here)\b/,
];
