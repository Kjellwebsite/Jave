import { REDACTED, redactString } from '../kernel/redact';

/**
 * Secrets removed before any text reaches an AI provider, in addition to the
 * kernel's patterns (Discord/Anthropic/OpenAI/GitHub tokens, JWTs).
 */
const AI_SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\bhf_[A-Za-z0-9]{30,}\b/g,
];

/** `password: hunter2`, `api_key="…"` — keep the label, drop the value. */
const LABELLED_SECRET =
  /\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)(\s*[:=]\s*)(["']?)[^\s"']{4,}\3/gi;

/** Credentials embedded in URLs or connection strings: scheme://user:pass@host. */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/gi;

export interface RedactionResult {
  text: string;
  redacted: boolean;
}

export function redactForAI(text: string): RedactionResult {
  let out = text;
  for (const pattern of AI_SECRET_PATTERNS) out = out.replace(pattern, REDACTED);
  out = out
    .replace(
      LABELLED_SECRET,
      (_m, label: string, separator: string) => `${label}${separator}${REDACTED}`,
    )
    .replace(URL_CREDENTIALS, (_m, scheme: string) => `${scheme}${REDACTED}@`);
  out = redactString(out);
  return { text: out, redacted: out !== text };
}
