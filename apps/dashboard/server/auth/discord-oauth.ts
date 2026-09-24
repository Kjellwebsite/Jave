import 'server-only';
import { z } from 'zod';
import { type DiscordProfile, ExternalServiceError } from '@jave/core';

export const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
export const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
export const DISCORD_ME_URL = 'https://discord.com/api/users/@me';
/** Identity only: JAVE never asks Discord for e-mail, guilds or messages. */
export const DISCORD_SCOPE = 'identify';
export const OAUTH_CALLBACK_PATH = '/api/auth/discord/callback';
const DISCORD_TIMEOUT_MS = 10_000;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function oauthRedirectUri(publicUrl: string): string {
  return new URL(OAUTH_CALLBACK_PATH, publicUrl).toString();
}

export function buildAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(DISCORD_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    scope: DISCORD_SCOPE,
    redirect_uri: input.redirectUri,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'none',
  }).toString();
  return url.toString();
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1).max(512),
  token_type: z.string().regex(/^bearer$/i),
});

const userResponseSchema = z.object({
  id: z.string().regex(/^\d{17,20}$/),
  username: z.string().min(1).max(64),
  global_name: z.string().max(64).nullable().optional(),
  avatar: z
    .string()
    .regex(/^(a_)?[a-f0-9]{32}$/)
    .nullable()
    .optional(),
  bot: z.boolean().optional(),
});

/**
 * The only code that talks to Discord's OAuth endpoints. Construct it with
 * the real `fetch` in production; tests inject a stub (TEST ONLY).
 */
export interface DiscordOAuthClient {
  /** Exchanges the authorization code (with its PKCE verifier) for an access token. */
  exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<string>;
  fetchProfile(accessToken: string): Promise<DiscordProfile>;
}

async function readJson(response: Response, what: string): Promise<unknown> {
  if (!response.ok) {
    // The body may echo credentials; never surface or log it.
    throw new ExternalServiceError('discord', `Discord ${what} failed (HTTP ${response.status}).`);
  }
  try {
    return await response.json();
  } catch {
    throw new ExternalServiceError('discord', `Discord ${what} returned an unreadable response.`);
  }
}

export function createDiscordOAuthClient(options: {
  clientId: string;
  clientSecret: string;
  fetch?: FetchLike;
}): DiscordOAuthClient {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  return {
    async exchangeCode({ code, codeVerifier, redirectUri }) {
      const response = await doFetch(DISCORD_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: options.clientId,
          client_secret: options.clientSecret,
          code_verifier: codeVerifier,
        }).toString(),
        signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
        cache: 'no-store',
      });
      const parsed = tokenResponseSchema.safeParse(await readJson(response, 'token exchange'));
      if (!parsed.success) {
        throw new ExternalServiceError(
          'discord',
          'Discord token exchange returned an unexpected shape.',
        );
      }
      return parsed.data.access_token;
    },
    async fetchProfile(accessToken) {
      const response = await doFetch(DISCORD_ME_URL, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
        cache: 'no-store',
      });
      const parsed = userResponseSchema.safeParse(await readJson(response, 'profile lookup'));
      if (!parsed.success) {
        throw new ExternalServiceError(
          'discord',
          'Discord profile lookup returned an unexpected shape.',
        );
      }
      return {
        discordId: parsed.data.id,
        username: parsed.data.username,
        displayName: parsed.data.global_name ?? null,
        avatarHash: parsed.data.avatar ?? null,
        isBot: parsed.data.bot ?? false,
      };
    },
  };
}
