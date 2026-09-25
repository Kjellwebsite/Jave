import { isSnowflake } from '../kernel/ids';

/**
 * An event location is one of: a Discord channel id (voice/stage/text), an
 * external http(s) URL, or a short physical location ("Lab 3, Berlin").
 * Anything that looks like a link with another scheme is rejected so no
 * surface can ever render a javascript:/data: link from it.
 */
export type LocationKind = 'channel' | 'url' | 'text';

const HTTP_URL = /^https?:\/\//i;
const ANY_SCHEME_URL = /^[a-z][a-z0-9+.-]*:\/\//i;
const DANGEROUS_SCHEME = /^\s*(javascript|data|vbscript|file|blob):/i;

function isHttpUrl(value: string): boolean {
  if (!HTTP_URL.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== '';
  } catch {
    return false;
  }
}

/** Returns the kind, or null when the value must be rejected. */
export function classifyLocation(value: string): LocationKind | null {
  if (isSnowflake(value)) return 'channel';
  if (isHttpUrl(value)) return 'url';
  if (HTTP_URL.test(value) || ANY_SCHEME_URL.test(value) || DANGEROUS_SCHEME.test(value)) {
    return null;
  }
  return 'text';
}

export interface LocationView {
  kind: LocationKind;
  value: string;
}

export function toLocationView(value: string | null): LocationView | null {
  if (!value) return null;
  const kind = classifyLocation(value);
  return kind ? { kind, value } : null;
}
