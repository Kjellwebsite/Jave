/**
 * How the Activity was opened. Discord loads it in an iframe with `frame_id`,
 * `instance_id`, … in the query string; anything else is the standalone dev
 * mode (MOCK / DEVELOPMENT ONLY), which signs in through dev personas.
 */
export type LaunchMode = 'discord' | 'dev';

export interface LaunchContext {
  mode: LaunchMode;
  /** Base path of the JAVE API on this origin. */
  apiBase: string;
  /** Dev mode only: the shared pseudo instance players meet in. */
  devInstanceId: string;
  /** Dev mode only: the persona requested in the URL, if valid. */
  devPersona: string | null;
}

/** Discord proxies Activity requests under `/.proxy/<mapping prefix>`. */
export const DISCORD_API_BASE = '/.proxy/api';
export const DIRECT_API_BASE = '/api';
export const DEFAULT_DEV_INSTANCE = 'dev-arena';
const DEV_INSTANCE_PREFIX = 'dev-';
const DEV_PARAM_PATTERN = /^[a-z0-9_-]{1,40}$/i;

/** The build flags that decide whether the standalone dev mode exists at all. */
export interface StandaloneFlags {
  DEV?: boolean;
  VITE_JAVE_STANDALONE_DEV?: string;
}

/**
 * MOCK / DEVELOPMENT ONLY — the standalone mode exists in dev-server builds,
 * or in a build that opts in with VITE_JAVE_STANDALONE_DEV=true (a staging
 * preview). A production build opened outside Discord asks to be launched
 * from Discord; the dashboard independently refuses dev tokens in production.
 */
export function standaloneDevAllowed(flags: StandaloneFlags): boolean {
  return flags.DEV === true || flags.VITE_JAVE_STANDALONE_DEV === 'true';
}

/** Only same-origin absolute paths: the CSP allows nothing else, and `//host` is another origin. */
export function isSafeApiBase(value: string): boolean {
  return /^\/(?!\/)[\w./-]*$/.test(value) && !value.includes('..');
}

export function detectLaunch(url: URL, configuredBase?: string): LaunchContext {
  const params = url.searchParams;
  const mode: LaunchMode = params.has('frame_id') ? 'discord' : 'dev';
  const fallback = mode === 'discord' ? DISCORD_API_BASE : DIRECT_API_BASE;
  const trimmed = configuredBase?.replace(/\/+$/, '');
  const apiBase = trimmed && isSafeApiBase(trimmed) ? trimmed : fallback;
  const instance = params.get('instance');
  const persona = params.get('persona');
  return {
    mode,
    apiBase,
    devInstanceId:
      instance && DEV_PARAM_PATTERN.test(instance)
        ? `${DEV_INSTANCE_PREFIX}${instance.replace(/^dev-/i, '')}`
        : DEFAULT_DEV_INSTANCE,
    devPersona: persona && DEV_PARAM_PATTERN.test(persona) ? persona : null,
  };
}
