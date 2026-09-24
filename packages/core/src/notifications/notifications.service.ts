import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  memberRoles,
  members,
  notificationDeliveries,
  notificationPreferences,
  notifications,
  userPreferences,
} from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { isUniqueViolation, NotFoundError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { enqueueJob } from '../jobs/queue';
import { requireUser } from '../permissions/authorize';
import { type Capability, ROLE_CAPABILITIES } from '../permissions/capabilities';
import type { OrgRole } from '../permissions/roles';
import { getSettings } from '../settings/settings.service';
import {
  NOTIFICATION_TYPES,
  type NotificationChannel,
  type NotificationSeverity,
  type NotificationType,
} from './catalog';
import { deliverAfter, type QuietHours } from './quiet-hours';

export const NOTIFICATION_DELIVER_JOB = 'notifications.deliver';

export interface NotifyInput {
  recipientUserId: string;
  type: NotificationType;
  title: string;
  body: string;
  severity?: NotificationSeverity;
  url?: string;
  data?: Record<string, unknown>;
  /** Suppresses duplicates of the same underlying fact (e.g. `trial:<id>:result:<member>`). */
  dedupeKey?: string;
  /** Override the type's default push channels. */
  channels?: readonly NotificationChannel[];
}

async function loadQuietHours(
  ctx: ServiceContext,
  userId: string,
): Promise<{ quiet: QuietHours | null; dm: boolean }> {
  const [prefs] = await ctx.db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId));
  const defaults = (await getSettings(ctx, 'notifications')).defaultQuietHours;
  const timezone = prefs?.timezone ?? 'UTC';
  if (prefs && prefs.quietHoursStart !== null && prefs.quietHoursEnd !== null) {
    return {
      quiet: { timezone, start: prefs.quietHoursStart, end: prefs.quietHoursEnd },
      dm: prefs.dmNotifications,
    };
  }
  return {
    quiet: defaults ? { timezone, start: defaults.start, end: defaults.end } : null,
    dm: prefs?.dmNotifications ?? true,
  };
}

async function channelEnabled(
  ctx: ServiceContext,
  userId: string,
  type: string,
  channel: NotificationChannel,
): Promise<boolean> {
  const rows = await ctx.db
    .select({ type: notificationPreferences.type, enabled: notificationPreferences.enabled })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.channel, channel),
        inArray(notificationPreferences.type, [type, '*']),
      ),
    );
  // A type-specific preference beats the wildcard.
  const specific = rows.find((r) => r.type === type);
  if (specific) return specific.enabled;
  const wildcard = rows.find((r) => r.type === '*');
  return wildcard ? wildcard.enabled : true;
}

/**
 * Create a notification: the dashboard inbox row plus one delivery job per
 * enabled push channel, deferred through quiet hours unless critical.
 * Returns the notification id, or null if deduplicated.
 */
export async function notify(ctx: ServiceContext, input: NotifyInput): Promise<string | null> {
  const definition = NOTIFICATION_TYPES[input.type];
  const severity = input.severity ?? definition.severity;
  const now = ctx.clock.now();

  let notificationId: string;
  try {
    const [row] = await ctx.db
      .insert(notifications)
      .values({
        recipientUserId: input.recipientUserId,
        type: input.type,
        severity,
        title: input.title.slice(0, 120),
        body: input.body.slice(0, 4000),
        url: input.url ?? null,
        data: input.data ?? {},
        dedupeKey: input.dedupeKey ?? null,
        createdAt: now,
      })
      .onConflictDoNothing({ target: notifications.dedupeKey })
      .returning({ id: notifications.id });
    if (!row) return null;
    notificationId = row.id;
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }

  const settings = await getSettings(ctx, 'notifications');
  const { quiet, dm } = await loadQuietHours(ctx, input.recipientUserId);
  for (const channel of input.channels ?? definition.channels) {
    if (channel === 'dashboard') continue;
    const enabled =
      (channel !== 'discord_dm' || (dm && settings.dmEnabled)) &&
      (await channelEnabled(ctx, input.recipientUserId, input.type, channel));
    // Email and webhook delivery have no provider in v0.1: recorded as skipped, never faked.
    const unsupported = channel === 'email' || channel === 'webhook';
    const when = deliverAfter(now, severity, quiet);
    const deferred = when.getTime() > now.getTime();
    const [delivery] = await ctx.db
      .insert(notificationDeliveries)
      .values({
        notificationId,
        channel,
        status: !enabled || unsupported ? 'skipped' : deferred ? 'deferred' : 'pending',
        lastError: unsupported
          ? `${channel} delivery is not configured`
          : !enabled
            ? 'disabled by preference'
            : null,
        deliverAfter: when,
        createdAt: now,
      })
      .returning({ id: notificationDeliveries.id });
    if (enabled && !unsupported && delivery) {
      await enqueueJob(
        ctx,
        NOTIFICATION_DELIVER_JOB,
        { deliveryId: delivery.id },
        { runAt: when, maxAttempts: 5 },
      );
    }
  }
  return notificationId;
}

/** Roles whose grants include `capability`. */
export function rolesWithCapability(capability: Capability): OrgRole[] {
  return (Object.entries(ROLE_CAPABILITIES) as [OrgRole, readonly Capability[]][])
    .filter(([, caps]) => caps.includes(capability))
    .map(([role]) => role);
}

/** Notify every member who holds `capability` (capped). */
export async function notifyCapabilityHolders(
  ctx: ServiceContext,
  capability: Capability,
  input: Omit<NotifyInput, 'recipientUserId'>,
  options: { excludeUserIds?: string[]; limit?: number } = {},
): Promise<number> {
  const roles = rolesWithCapability(capability);
  if (roles.length === 0) return 0;
  const recipients = await ctx.db
    .selectDistinct({ userId: members.userId })
    .from(memberRoles)
    .innerJoin(members, eq(members.id, memberRoles.memberId))
    .where(
      and(
        inArray(memberRoles.role, roles),
        isNull(memberRoles.revokedAt),
        eq(members.standing, 'good'),
      ),
    )
    .limit(options.limit ?? 50);
  let sent = 0;
  for (const { userId } of recipients) {
    if (options.excludeUserIds?.includes(userId)) continue;
    const id = await notify(ctx, {
      ...input,
      recipientUserId: userId,
      dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${userId}` : undefined,
    });
    if (id) sent++;
  }
  return sent;
}

export const listNotificationsSchema = z.object({
  unreadOnly: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(30),
});

export async function listMyNotifications(
  ctx: ServiceContext,
  input: z.input<typeof listNotificationsSchema> = {},
) {
  const actor = requireUser(ctx);
  const q = parseInput(listNotificationsSchema, input);
  const where = q.unreadOnly
    ? and(eq(notifications.recipientUserId, actor.userId), isNull(notifications.readAt))
    : eq(notifications.recipientUserId, actor.userId);
  const [items, [unread]] = await Promise.all([
    ctx.db
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(q.limit),
    ctx.db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.recipientUserId, actor.userId), isNull(notifications.readAt))),
  ]);
  return { items, unread: unread?.value ?? 0 };
}

export async function markNotificationsRead(
  ctx: ServiceContext,
  ids: string[] | 'all',
): Promise<number> {
  const actor = requireUser(ctx);
  const now = ctx.clock.now();
  const base = and(eq(notifications.recipientUserId, actor.userId), isNull(notifications.readAt));
  const rows = await ctx.db
    .update(notifications)
    .set({ readAt: now })
    .where(ids === 'all' ? base : and(base, inArray(notifications.id, ids.slice(0, 200))))
    .returning({ id: notifications.id });
  return rows.length;
}

export const preferencesSchema = z.object({
  timezone: z
    .string()
    .max(64)
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'unknown timezone')
    .optional(),
  quietHours: z
    .object({ start: z.number().int().min(0).max(1439), end: z.number().int().min(0).max(1439) })
    .nullable()
    .optional(),
  dmNotifications: z.boolean().optional(),
  channels: z
    .array(
      z.object({
        type: z.string().max(64),
        channel: z.enum(['discord_dm', 'email', 'webhook']),
        enabled: z.boolean(),
      }),
    )
    .max(100)
    .optional(),
});

export async function getMyPreferences(ctx: ServiceContext) {
  const actor = requireUser(ctx);
  const [prefs] = await ctx.db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, actor.userId));
  const channels = await ctx.db
    .select({
      type: notificationPreferences.type,
      channel: notificationPreferences.channel,
      enabled: notificationPreferences.enabled,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, actor.userId));
  return {
    timezone: prefs?.timezone ?? 'UTC',
    quietHours:
      prefs && prefs.quietHoursStart !== null && prefs.quietHoursEnd !== null
        ? { start: prefs.quietHoursStart, end: prefs.quietHoursEnd }
        : null,
    dmNotifications: prefs?.dmNotifications ?? true,
    channels,
  };
}

export async function updateMyPreferences(
  ctx: ServiceContext,
  input: z.input<typeof preferencesSchema>,
) {
  const actor = requireUser(ctx);
  const data = parseInput(preferencesSchema, input);
  const values = {
    userId: actor.userId,
    ...(data.timezone !== undefined && { timezone: data.timezone }),
    ...(data.quietHours !== undefined && {
      quietHoursStart: data.quietHours?.start ?? null,
      quietHoursEnd: data.quietHours?.end ?? null,
    }),
    ...(data.dmNotifications !== undefined && { dmNotifications: data.dmNotifications }),
  };
  await ctx.db
    .insert(userPreferences)
    .values(values)
    .onConflictDoUpdate({ target: userPreferences.userId, set: values });
  for (const pref of data.channels ?? []) {
    await ctx.db
      .insert(notificationPreferences)
      .values({ userId: actor.userId, ...pref })
      .onConflictDoUpdate({
        target: [
          notificationPreferences.userId,
          notificationPreferences.type,
          notificationPreferences.channel,
        ],
        set: { enabled: pref.enabled },
      });
  }
  return getMyPreferences(ctx);
}

/** Load a delivery with its notification for a channel handler (used by the bot). */
export async function loadDelivery(ctx: ServiceContext, deliveryId: string) {
  const [row] = await ctx.db
    .select({ delivery: notificationDeliveries, notification: notifications })
    .from(notificationDeliveries)
    .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
    .where(eq(notificationDeliveries.id, deliveryId));
  if (!row) throw new NotFoundError('Notification delivery');
  return row;
}

export async function markDelivery(
  ctx: ServiceContext,
  deliveryId: string,
  outcome: { status: 'sent' | 'failed' | 'skipped'; error?: string },
): Promise<void> {
  await ctx.db
    .update(notificationDeliveries)
    .set({
      status: outcome.status,
      lastError: outcome.error?.slice(0, 1000) ?? null,
      sentAt: outcome.status === 'sent' ? ctx.clock.now() : null,
      attempts: sql`${notificationDeliveries.attempts} + 1`,
    })
    .where(eq(notificationDeliveries.id, deliveryId));
}
