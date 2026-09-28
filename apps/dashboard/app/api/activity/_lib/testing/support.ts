/**
 * TEST ONLY — helpers for driving the Activity handlers with constructed
 * Requests against a PGlite-backed (or real Postgres) TestKit.
 */
import { anonymousActor, ExternalServiceError, type UserActor } from '@jave/core';
import type { TestKit } from '@jave/core/testing';
import type { ActivityDeps } from '../deps';
import type { ActivityDiscordClient } from '../discord';
import { acceptWellFormedInstance } from '../instance';
import { issueActivityToken } from '../token';

export const TEST_SECRET = 'activity-handler-test-secret-activity-handler-01';
export const INSTANCE = 'i-1263209785744457798-gc-1087860016624631818-1264011010839527505';
export const OTHER_INSTANCE = 'i-1263209785744457799-gc-1087860016624631818-1264011010839527506';
const BASE_URL = 'http://localhost:3000/api/activity';

export function testDeps(kit: TestKit, overrides: Partial<ActivityDeps> = {}): ActivityDeps {
  return {
    context: () => kit.as(anonymousActor),
    sessionSecret: TEST_SECRET,
    devAuthEnabled: false,
    discord: null,
    instanceVerifier: acceptWellFormedInstance,
    ...overrides,
  };
}

export function tokenFor(
  kit: TestKit,
  actor: UserActor,
  options: { instanceId?: string; mode?: 'discord' | 'dev'; secret?: string } = {},
): string {
  return issueActivityToken(
    {
      userId: actor.userId,
      instanceId: options.instanceId ?? INSTANCE,
      mode: options.mode ?? 'discord',
    },
    options.secret ?? TEST_SECRET,
    kit.clock.now(),
  ).token;
}

export interface RequestOptions {
  token?: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
}

export function apiRequest(method: 'GET' | 'POST', path: string, options: RequestOptions = {}) {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  let body: string | undefined;
  if (options.rawBody !== undefined) body = options.rawBody;
  else if (options.body !== undefined) body = JSON.stringify(options.body);
  if (body !== undefined && !headers['content-type']) headers['content-type'] = 'application/json';
  return new Request(`${BASE_URL}${path}`, { method, headers, body });
}

export async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** TEST ONLY — a Discord stand-in that returns a fixed identity for one known code. */
export function fakeDiscord(
  profile: { discordId: string; username: string; isBot?: boolean },
  validCode = 'valid-code',
): ActivityDiscordClient & { exchanged: string[] } {
  const exchanged: string[] = [];
  return {
    exchanged,
    async exchange(code) {
      exchanged.push(code);
      if (code !== validCode) {
        throw new ExternalServiceError('discord', 'Discord token exchange failed (HTTP 400).');
      }
      return {
        accessToken: 'discord-access-token-test',
        profile: {
          discordId: profile.discordId,
          username: profile.username,
          displayName: profile.username,
          avatarHash: null,
          isBot: profile.isBot ?? false,
        },
      };
    },
  };
}
