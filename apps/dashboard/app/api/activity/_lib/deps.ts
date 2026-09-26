import type { ServiceContext } from '@jave/core';
import type { ActivityDiscordClient } from './discord';
import type { InstanceVerifier } from './instance';

/**
 * Everything an Activity handler needs from the process. Route files pass the
 * runtime implementation (`runtime.ts`); tests pass a PGlite-backed one.
 */
export interface ActivityDeps {
  /** A fresh anonymous context for this request (own request id, shared db/cache/clock). */
  context(): ServiceContext;
  /** JAVE_SESSION_SECRET: signs Activity tokens and keys client-IP hashes. */
  sessionSecret: string;
  /** MOCK / DEVELOPMENT ONLY: JAVE_DEV_AUTH=true and NODE_ENV is not production. */
  devAuthEnabled: boolean;
  /** Null when DISCORD_CLIENT_SECRET is not configured. */
  discord: ActivityDiscordClient | null;
  instanceVerifier: InstanceVerifier;
}
