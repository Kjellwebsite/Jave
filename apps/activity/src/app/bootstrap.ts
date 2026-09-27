import { ApiClient } from '../api/client';
import { ActivitySession, ServerClock } from '../api/session';
import { type ActivityHost, createDevHost, createDiscordHost } from '../platform/hosts';
import { detectLaunch, type LaunchContext, standaloneDevAllowed } from '../platform/launch';

/** Default persona of the standalone dev mode (MOCK / DEVELOPMENT ONLY). */
export const DEFAULT_DEV_PERSONA = 'verified';
const DISCORD_APPLICATION_ID = /^\d{17,20}$/;

export interface BootProblem {
  title: string;
  description: string;
}

export type Boot =
  | {
      ok: true;
      launch: LaunchContext;
      session: ActivitySession;
      api: ApiClient;
      persona: string | null;
    }
  | { ok: false; launch: LaunchContext; problem: BootProblem };

/** The SDK constructor throws when Discord's launch parameters (instance_id, platform, …) are missing. */
function discordHost(clientId: string, api: ApiClient): ActivityHost | null {
  try {
    return createDiscordHost(clientId, api);
  } catch {
    return null;
  }
}

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
    if (!clientId || !DISCORD_APPLICATION_ID.test(clientId)) {
      return {
        ok: false,
        launch,
        problem: {
          title: 'NOT CONFIGURED',
          description: 'This build has no Discord application id (VITE_DISCORD_CLIENT_ID).',
        },
      };
    }
    const host = discordHost(clientId, api);
    if (!host) {
      return {
        ok: false,
        launch,
        problem: {
          title: 'LAUNCH INCOMPLETE',
          description:
            'Discord did not pass the launch details. Close the Activity and start it again.',
        },
      };
    }
    return { ok: true, launch, session: new ActivitySession(host, api, clock), api, persona: null };
  }
  if (!standaloneDevAllowed(import.meta.env)) {
    return {
      ok: false,
      launch,
      problem: {
        title: 'OPEN IN DISCORD',
        description: 'JVLN runs inside Discord. Start it from a voice channel or the App Launcher.',
      },
    };
  }
  const persona = launch.devPersona ?? DEFAULT_DEV_PERSONA;
  const host = createDevHost(persona, launch.devInstanceId, api);
  return { ok: true, launch, session: new ActivitySession(host, api, clock), api, persona };
}
