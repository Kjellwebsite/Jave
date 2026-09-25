/** Largest context document rendered inline; longer ones are cut with a marker. */
export const MAX_CONTEXT_CHARS = 6_000;
const INDENT = 2;

/**
 * Pretty JSON for the context viewer. Rendered as a React text node (escaped),
 * never as HTML. Values are already redacted by the audit service on write.
 */
export function formatAuditContext(context: Record<string, unknown>): string | null {
  if (Object.keys(context).length === 0) return null;
  let text: string;
  try {
    text = JSON.stringify(context, null, INDENT);
  } catch {
    return '[unserializable context]';
  }
  return text.length > MAX_CONTEXT_CHARS
    ? `${text.slice(0, MAX_CONTEXT_CHARS)}\n… [truncated]`
    : text;
}

/** `member:5b2c…` — a compact target label. */
export function formatAuditTarget(type: string | null, id: string | null): string {
  if (!type && !id) return '—';
  const shortId = id && id.length > 12 ? `${id.slice(0, 8)}…` : id;
  return [type, shortId].filter(Boolean).join(':');
}
