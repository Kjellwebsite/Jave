import { z } from 'zod';

/**
 * Discord Activity instance ids look like `i-1263209785744457798-gc-…`; the
 * standalone dev mode uses `dev-<name>`. Same bounds as core's game session
 * column (≤ 128, word characters and hyphens).
 */
export const MAX_INSTANCE_ID_LENGTH = 128;

export const activityInstanceIdSchema = z
  .string()
  .min(1)
  .max(MAX_INSTANCE_ID_LENGTH)
  .regex(/^[\w-]+$/, 'must be an Activity instance id');

/**
 * EXTENSION POINT — instance membership.
 *
 * The instance id arrives from the client (`discordSdk.instanceId`). It only
 * scopes which lobby a player shares; it grants nothing. A stricter verifier
 * can confirm the user is really in the instance with Discord's
 * `GET /applications/{application.id}/activity-instances/{instance_id}`
 * (bot token; the response lists the participating user ids) — the dashboard
 * does not hold the bot token today, so the default accepts any well-formed id.
 * See docs/ACTIVITY.md "Limitations".
 */
export type InstanceVerifier = (input: {
  instanceId: string;
  discordUserId: string;
}) => Promise<boolean>;

export const acceptWellFormedInstance: InstanceVerifier = async ({ instanceId }) =>
  activityInstanceIdSchema.safeParse(instanceId).success;
