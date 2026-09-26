import { DiscordSDK, DiscordSDKMock } from '@discord/embedded-app-sdk';
import type { ApiClient } from '../api/client';
import type { ActivityTokenResponse } from '../api/contract';

/** What the rest of the app knows about the signed-in session. */
export interface AuthSession {
  token: string;
  /** Server epoch ms. */
  expiresAt: number;
  mode: 'discord' | 'dev';
  displayName: string;
  instanceId: string;
}

/**
 * The embedding environment: Discord (real SDK) or the standalone dev page
 * (MOCK / DEVELOPMENT ONLY). `signIn` runs the whole flow and can be called
 * again to refresh the JAVE token.
 */
export interface ActivityHost {
  mode: 'discord' | 'dev';
  instanceId: string;
  signIn(): Promise<AuthSession>;
}

export class AuthMismatchError extends Error {
  constructor() {
    super('Discord and JAVE disagree about who is signed in.');
    this.name = 'AuthMismatchError';
  }
}

const STATE_BYTES = 16;

function randomState(): string {
  const bytes = new Uint8Array(STATE_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toSession(issued: ActivityTokenResponse, instanceId: string): AuthSession {
  return {
    token: issued.jave_token,
    expiresAt: issued.expiresAt,
    mode: issued.mode,
    displayName: issued.user.displayName,
    instanceId,
  };
}

/**
 * Discord: ready() → authorize (identify, silent) → POST /activity/token
 * (the dashboard exchanges the code) → authenticate with the access token.
 */
export function createDiscordHost(clientId: string, api: ApiClient): ActivityHost {
  const sdk = new DiscordSDK(clientId);
  let ready: Promise<void> | null = null;
  return {
    mode: 'discord',
    instanceId: sdk.instanceId,
    async signIn() {
      ready ??= sdk.ready();
      await ready;
      const { code } = await sdk.commands.authorize({
        client_id: clientId,
        response_type: 'code',
        state: randomState(),
        prompt: 'none',
        scope: ['identify'],
      });
      const issued = await api.request<ActivityTokenResponse>('POST', '/activity/token', {
        body: { code, instanceId: sdk.instanceId },
      });
      if (!issued.access_token) throw new AuthMismatchError();
      const auth = await sdk.commands.authenticate({ access_token: issued.access_token });
      if (auth.user.id !== issued.user.discordId) throw new AuthMismatchError();
      return toSession(issued, sdk.instanceId);
    },
  };
}

/** MOCK / DEVELOPMENT ONLY — the SDK's mock client plus a dev-persona token. */
const MOCK_CLIENT_ID = 'jave-activity-dev';

export function createDevHost(persona: string, instanceId: string, api: ApiClient): ActivityHost {
  const sdk = new DiscordSDKMock(MOCK_CLIENT_ID, null, null, null);
  return {
    mode: 'dev',
    instanceId,
    async signIn() {
      await sdk.ready();
      const issued = await api.request<ActivityTokenResponse>('POST', '/activity/dev-token', {
        body: { persona, instanceId },
      });
      return toSession(issued, instanceId);
    },
  };
}
