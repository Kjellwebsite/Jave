import 'server-only';
import { z } from 'zod';
import { type DiscordProfile, ExternalServiceError } from '@jave/core';
import {
  createDiscordOAuthClient,
  DISCORD_SCOPE,
  DISCORD_TOKEN_URL,
  type FetchLike,
} from '@/server/auth/discord-oauth';

const DISCORD_TIMEOUT_MS = 10_000;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1).max(512),
  token_type: z.string().regex(/^bearer$/i),
  scope: z.string().max(1024),
});

export interface ActivityDiscordSession {
  /** Returned to the Activity for `commands.authenticate`; never stored or logged. */
  accessToken: string;
  profile: DiscordProfile;
}

/**
 * The Activity's half of Discord OAuth2. `commands.authorize` runs inside the
 * Discord client, so the code is exchanged without redirect URI or PKCE
 * (Embedded App SDK flow). Only the `identify` scope is accepted.
 */
export interface ActivityDiscordClient {
  exchange(code: string): Promise<ActivityDiscordSession>;
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    // The body may echo credentials; never surface or log it.
    throw new ExternalServiceError(
      'discord',
      `Discord token exchange failed (HTTP ${response.status}).`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new ExternalServiceError(
      'discord',
      'Discord token exchange returned an unreadable body.',
    );
  }
}

export function createActivityDiscordClient(options: {
  clientId: string;
  clientSecret: string;
  /** Real `fetch` in production; tests inject a stub (TEST ONLY). */
  fetch?: FetchLike;
}): ActivityDiscordClient {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const profiles = createDiscordOAuthClient({ ...options, fetch: doFetch });
  return {
    async exchange(code) {
      const response = await doFetch(DISCORD_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: options.clientId,
          client_secret: options.clientSecret,
        }).toString(),
        signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
        cache: 'no-store',
      });
      const parsed = tokenResponseSchema.safeParse(await readJson(response));
      if (!parsed.success) {
        throw new ExternalServiceError(
          'discord',
          'Discord token exchange returned an unexpected shape.',
        );
      }
      if (!parsed.data.scope.split(/\s+/).includes(DISCORD_SCOPE)) {
        throw new ExternalServiceError(
          'discord',
          'Discord did not grant the identify scope.',
          false,
        );
      }
      const accessToken = parsed.data.access_token;
      return { accessToken, profile: await profiles.fetchProfile(accessToken) };
    },
  };
}
