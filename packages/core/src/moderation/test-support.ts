import { and, eq } from 'drizzle-orm';
import { auditLogs, domainEvents, jobs, notifications } from '@jave/database';
import type { TestKit } from '../testing';
import { updateSettings } from '../settings/settings.service';

/** Test fixtures for the moderation module. Not exported from the module index. */

/**
 * PGlite-backed suites: the first kit in a worker builds the migrated snapshot,
 * which takes about a minute on a loaded shared machine. Only time limits are
 * raised; assertions are unchanged. Apply with `vi.setConfig(...)` per file.
 */
export const INTEGRATION_TIMEOUTS = { testTimeout: 60_000, hookTimeout: 180_000 } as const;

export const QUARANTINE_ROLE_ID = '400000000000000001';
export const VERIFIED_ROLE_ID = '400000000000000002';
export const MODERATOR_ROLE_ID = '400000000000000003';
export const ALERT_CHANNEL_ID = '500000000000000001';
export const MESSAGE_CHANNEL_ID = '500000000000000002';

const DISCORD_EPOCH_MS = 1_420_070_400_000n;
const TIMESTAMP_SHIFT = 22n;
let sequence = 0n;

/** A Discord ID whose embedded creation time is `date` (for account-age tests). */
export function snowflakeAt(date: Date): string {
  sequence += 1n;
  return (((BigInt(date.getTime()) - DISCORD_EPOCH_MS) << TIMESTAMP_SHIFT) + sequence).toString();
}

export async function configureModeration(
  kit: TestKit,
  options: { quarantineRole?: boolean; alertChannel?: boolean } = {},
): Promise<void> {
  await updateSettings(kit.system, 'roles', {
    ...(options.quarantineRole !== false && { quarantineRoleId: QUARANTINE_ROLE_ID }),
    discordRoleIds: { verified: VERIFIED_ROLE_ID, moderator: MODERATOR_ROLE_ID },
  });
  if (options.alertChannel !== false) {
    await updateSettings(kit.system, 'channels', { securityAlerts: ALERT_CHANNEL_ID });
  }
}

export async function jobsOfType(kit: TestKit, type: string) {
  return kit.db.select().from(jobs).where(eq(jobs.type, type));
}

export async function auditsOf(kit: TestKit, action: string) {
  return kit.db.select().from(auditLogs).where(eq(auditLogs.action, action));
}

export async function eventsOf(kit: TestKit, type: string) {
  return kit.db.select().from(domainEvents).where(eq(domainEvents.type, type));
}

export async function notificationsFor(kit: TestKit, userId: string, type?: string) {
  return kit.db
    .select()
    .from(notifications)
    .where(
      type
        ? and(eq(notifications.recipientUserId, userId), eq(notifications.type, type))
        : eq(notifications.recipientUserId, userId),
    );
}
