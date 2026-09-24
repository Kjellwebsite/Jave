/**
 * Removes secret-looking values before data reaches logs, audit context or
 * AI prompts. Conservative: redacts by key name and by value shape.
 */
const SECRET_KEY =
  /(token|secret|password|passwd|authorization|cookie|api[_-]?key|private[_-]?key|credential|session)/i;
const SECRET_VALUE = [
  /[MN][A-Za-z\d]{23,25}\.[\w-]{6}\.[\w-]{27,}/, // Discord bot token
  /sk-(ant-)?[A-Za-z0-9_-]{20,}/, // Anthropic / OpenAI style keys
  /gh[pousr]_[A-Za-z0-9]{36,}/, // GitHub tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT
];

export const REDACTED = '[REDACTED]';

export function redactString(value: string): string {
  let out = value;
  for (const pattern of SECRET_VALUE) {
    out = out.replace(new RegExp(pattern.source, 'g'), REDACTED);
  }
  return out;
}

export function redact<T>(value: T, depth = 0): T {
  if (depth > 8) return '[TRUNCATED]' as T;
  if (typeof value === 'string') return redactString(value) as T;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1)) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? REDACTED : redact(inner, depth + 1);
    }
    return out as T;
  }
  return value;
}

/** Truncate long free text (e.g. message excerpts in evidence). */
export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
