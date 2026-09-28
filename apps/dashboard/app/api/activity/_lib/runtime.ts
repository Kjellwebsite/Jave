import 'server-only';
import { isDevAuthEnabled } from '@/server/auth/dev-auth';
import { baseContext } from '@/server/context';
import { getRuntime } from '@/server/runtime';
import type { ActivityDeps } from './deps';
import { createActivityDiscordClient } from './discord';
import { acceptWellFormedInstance } from './instance';

/** The process dependencies of every Activity route (env parsed once by getRuntime). */
export function activityDeps(): ActivityDeps {
  const { env } = getRuntime();
  return {
    context: baseContext,
    sessionSecret: env.JAVE_SESSION_SECRET,
    devAuthEnabled: isDevAuthEnabled(env),
    discord: env.DISCORD_CLIENT_SECRET
      ? createActivityDiscordClient({
          clientId: env.DISCORD_CLIENT_ID,
          clientSecret: env.DISCORD_CLIENT_SECRET,
        })
      : null,
    instanceVerifier: acceptWellFormedInstance,
  };
}
