/** Returns the URL only when it is an absolute http(s) URL; anything else (javascript:, data:, relative) is dropped. */
export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** A same-origin, absolute-path link (e.g. from a notification), or null. */
export function safeInternalPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    return null;
  try {
    const url = new URL(value, 'http://jave.invalid');
    return url.origin === 'http://jave.invalid' ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}
