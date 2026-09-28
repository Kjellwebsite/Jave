import 'server-only';
import { placeholderOverride, vercelEnv } from './env';

/**
 * Open before launch (see README): the prototype's reviews and ratings are invented, and some
 * links have no destination yet. Fake reviews are actionable under EU consumer law, so
 * placeholder content is shown locally and on Vercel preview deployments only, where the design
 * is reviewed, and never on the production deployment. `LULL_PLACEHOLDERS=show|hide` overrides.
 */
export function placeholdersEnabled(): boolean {
  const override = placeholderOverride();
  if (override) return override === 'show';
  return vercelEnv() !== 'production';
}

/** Link of the lab report for the current batch. Unknown yet: do not invent one. */
export const CERTIFICATE_REPORT_URL: string | null = null;

/** Where "Frag uns direkt" leads (mailto: or a contact page). Unknown yet. */
export const CONTACT_URL: string | null = null;

/**
 * A real destination, the prototype's in-page anchor while placeholders are shown, or null
 * (the element is then left out).
 */
export function pendingHref(real: string | null, placeholder: string): string | null {
  if (real) return real;
  return placeholdersEnabled() ? placeholder : null;
}
