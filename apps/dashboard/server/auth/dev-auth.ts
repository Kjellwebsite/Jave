import 'server-only';
/**
 * DEV LOGIN — MOCK / DEVELOPMENT ONLY.
 *
 * Signs in as a deterministic fake Discord user with a fixed role, so the
 * dashboard can be developed and end-to-end tested without Discord. It is
 * enabled only when JAVE_DEV_AUTH=true AND the runtime NODE_ENV is not
 * `production`; the environment schema additionally refuses to boot a
 * production process with JAVE_DEV_AUTH set. Every sign-in is audited as
 * `auth.dev_login`.
 */
import type { DashboardEnv } from '@jave/config';

export { DEV_PERSONAS, type DevPersona, findDevPersona, provisionDevPersona } from './dev-personas';

/** The runtime guard. Both conditions are required; production can never pass. */
export function isDevAuthEnabled(env: Pick<DashboardEnv, 'JAVE_DEV_AUTH' | 'NODE_ENV'>): boolean {
  return env.JAVE_DEV_AUTH === true && env.NODE_ENV !== 'production';
}
