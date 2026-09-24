import { z } from 'zod';
import { integrationProvider } from '@jave/database';

export type IntegrationProvider = (typeof integrationProvider.enumValues)[number];

export const INTEGRATION_PROVIDERS = integrationProvider.enumValues;

/**
 * Providers verified with the JAVE v1 scheme and a JAVE-generated secret.
 * GitHub uses its own scheme with the deployment's GITHUB_WEBHOOK_SECRET.
 */
export const JAVE_SIGNED_PROVIDERS: readonly IntegrationProvider[] = [
  'generic',
  'sidus',
  'supabase',
  'monitoring',
];

export function usesJaveSignature(provider: IntegrationProvider): boolean {
  return JAVE_SIGNED_PROVIDERS.includes(provider);
}

/** Inbound URL segment: /api/webhooks/{slug}. */
export const INTEGRATION_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,46})[a-z0-9]$/;

export const integrationSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(INTEGRATION_SLUG_PATTERN, 'use 3–48 lowercase letters, digits and hyphens');

export const WEBHOOK_PATH_PREFIX = '/api/webhooks/';

const MAX_CONFIG_KEYS = 20;
const MAX_CONFIG_STRING = 500;
const CONFIG_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
/** Config is non-secret by contract: keys that look like credentials are refused outright. */
const SECRET_LIKE_KEY =
  /(token|secret|password|passwd|authorization|cookie|api[_-]?key|private[_-]?key|credential|session)/i;
const SNOWFLAKE = /^\d{17,20}$/;

/** Known config fields. */
export const RELAY_CHANNEL_KEY = 'relayChannelId';

const scalar = z.union([z.string().max(MAX_CONFIG_STRING), z.number().finite(), z.boolean()]);

/**
 * Non-secret integration configuration: a flat map of scalars.
 * `relayChannelId` (Discord channel snowflake) enables relaying generic
 * deliveries to Discord.
 */
export const integrationConfigSchema = z
  .record(z.string().regex(CONFIG_KEY, 'config keys are identifiers'), scalar)
  .refine((config) => Object.keys(config).length <= MAX_CONFIG_KEYS, 'too many config keys')
  .refine(
    (config) => Object.keys(config).every((key) => !SECRET_LIKE_KEY.test(key)),
    'secrets never go in config — JAVE generates and encrypts signing secrets',
  )
  .refine((config) => {
    const channel = config[RELAY_CHANNEL_KEY];
    return channel === undefined || (typeof channel === 'string' && SNOWFLAKE.test(channel));
  }, `${RELAY_CHANNEL_KEY} must be a Discord channel ID`);

export type IntegrationConfig = z.infer<typeof integrationConfigSchema>;

export function relayChannelOf(config: Record<string, unknown>): string | null {
  const channel = config[RELAY_CHANNEL_KEY];
  return typeof channel === 'string' && SNOWFLAKE.test(channel) ? channel : null;
}
