/**
 * Absolute dashboard URL for a console path, or null when no http(s) public
 * URL is configured (Discord rejects link buttons with anything else).
 */
export function dashboardLink(publicUrl: string | undefined, path: string): string | null {
  if (!publicUrl || !path.startsWith('/')) return null;
  let base: URL;
  try {
    base = new URL(publicUrl);
  } catch {
    return null;
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;
  if (base.username || base.password) return null;
  return new URL(path, base.origin).toString();
}
