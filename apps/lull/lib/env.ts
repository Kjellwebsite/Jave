import 'server-only';

/**
 * The only place the app reads `process.env` (next.config.ts aside). Values are read per call,
 * so static pages see build-time values and route handlers see runtime values.
 */

/** `production`, `preview` or `development` on Vercel; undefined elsewhere. */
export function vercelEnv(): string | undefined {
  return process.env.VERCEL_ENV;
}

/** `show` or `hide` forces placeholder content on or off, see `lib/launch.ts`. */
export function placeholderOverride(): 'show' | 'hide' | undefined {
  const value = process.env.LULL_PLACEHOLDERS;
  return value === 'show' || value === 'hide' ? value : undefined;
}

export function stripeSecretKey(): string | undefined {
  return process.env.STRIPE_SECRET_KEY || undefined;
}

/** Canonical origin for metadata. Falls back to Vercel's production domain, then localhost. */
export function siteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return new URL(explicit);
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return new URL(`https://${vercel}`);
  return new URL('http://localhost:3100');
}
