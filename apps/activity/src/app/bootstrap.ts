import { ApiClient } from '../api/client';
import { ActivitySession, ServerClock } from '../api/session';
import { createDevHost, createDiscordHost } from '../platform/hosts';
import { detectLaunch, type LaunchContext } from '../platform/launch';

/** Default persona of the standalone dev mode (MOCK / DEVELOPMENT ONLY). */
export const DEFAULT_DEV_PERSONA = 'verified';

export type Boot =
  | { ok: true; launch: LaunchContext; session: ActivitySession; api: ApiClient; persona: string | null }
  | { ok: false; launch: LaunchContext; problem: string };

/**
 * Built once, outside React: the Discord SDK must be constructed exactly once
 * per page, and the session object owns the token for the page's lifetime.
 */
export function bootstrap(location: Location): Boot {
  const launch = detectLaunch(new URL(location.href), import.meta.env.VITE_JAVE_API_BASE);
  const api = new ApiClient(launch.apiBase);
  const clock = new ServerClock();
  if (launch.mode === 'discord') {
    const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
    if (!clientId || !/^\d{17,20}$/.test(clientId)) {
      return {
        ok: false,
        launch,
        problem: 'This build has no Discord application id (VITE_DISCORD_CLIENT_ID).',
      };
    }
    const host = createDiscordHost(clientId, api);
    return { ok: true, launch, session: new ActivitySession(host, api, clock), api, persona: null };
  }
  const persona = launch.devPersona ?? DEFAULT_DEV_PERSONA;
  const host = createDevHost(persona, launch.devInstanceId, api);
  return { ok: true, launch, session: new ActivitySession(host, api, clock), api, persona };
}
