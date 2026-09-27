/**
 * Safety rules for the development seed. Pure functions: the CLI feeds them
 * the environment and refuses to touch a database when they object.
 *
 * - Never under NODE_ENV=production.
 * - Never against a URL that names production (`prod` in host or database).
 * - `--reset` (which deletes every row) only on a local database: a loopback
 *   host, `*.localhost`, or a single-label host such as the `postgres`
 *   service of docker-compose. Managed databases have dotted host names.
 */

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
const PRODUCTION_MARKER = /prod/i;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const IPV4_LOOPBACK = /^127(?:\.\d{1,3}){3}$/;
const LOCALHOST_SUFFIX = '.localhost';

export interface SeedEnvironment {
  nodeEnv: string | undefined;
  databaseUrl: string | undefined;
  reset: boolean;
}

export interface DatabaseTarget {
  host: string;
  database: string;
}

/** Host and database name of a postgres URL, or null when it is not one. */
export function parseDatabaseTarget(databaseUrl: string): DatabaseTarget | null {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return null;
  }
  if (!POSTGRES_PROTOCOLS.has(url.protocol)) return null;
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!url.hostname || !database) return null;
  return { host: url.hostname.toLowerCase(), database };
}

/** Loopback, *.localhost, or a single-label (docker-compose service) host. */
export function isLocalHost(host: string): boolean {
  if (LOOPBACK_HOSTS.has(host) || IPV4_LOOPBACK.test(host)) return true;
  if (host.endsWith(LOCALHOST_SUFFIX)) return true;
  return !host.includes('.') && !host.includes(':');
}

/** Why the seed must not run, or null when it may. Never includes credentials. */
export function seedRefusal(env: SeedEnvironment): string | null {
  if (env.nodeEnv === 'production') {
    return 'refusing to seed: NODE_ENV is production. The development seed never runs there.';
  }
  if (!env.databaseUrl) return 'refusing to seed: DATABASE_URL is not set.';
  const target = parseDatabaseTarget(env.databaseUrl);
  if (!target) return 'refusing to seed: DATABASE_URL is not a postgres:// URL with a database.';
  if (PRODUCTION_MARKER.test(target.host) || PRODUCTION_MARKER.test(target.database)) {
    return `refusing to seed "${target.database}" on ${target.host}: the URL names production.`;
  }
  if (env.reset && !isLocalHost(target.host)) {
    return `refusing to reset "${target.database}" on ${target.host}: --reset only runs against a local database.`;
  }
  return null;
}
