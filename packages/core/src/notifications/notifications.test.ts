import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { jobs, notificationDeliveries } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { deliverAfter, isWithinQuietHours, localMinutes } from './quiet-hours';
import {
  listMyNotifications,
  markNotificationsRead,
  notify,
  updateMyPreferences,
} from './notifications.service';

describe('quiet hours', () => {
  it('handles windows that wrap midnight', () => {
    expect(isWithinQuietHours(23 * 60, 22 * 60, 7 * 60)).toBe(true);
    expect(isWithinQuietHours(3 * 60, 22 * 60, 7 * 60)).toBe(true);
    expect(isWithinQuietHours(12 * 60, 22 * 60, 7 * 60)).toBe(false);
    expect(isWithinQuietHours(12 * 60, 9 * 60, 17 * 60)).toBe(true);
    expect(isWithinQuietHours(5, 5, 5)).toBe(false);
  });

  it('respects the user timezone', () => {
    const noonUtc = new Date('2026-06-01T12:00:00Z');
    expect(localMinutes(noonUtc, 'Europe/Amsterdam')).toBe(14 * 60);
    expect(localMinutes(noonUtc, 'Not/AZone')).toBe(12 * 60);
  });

  it('defers until quiet hours end, except critical', () => {
    const now = new Date('2026-06-01T23:30:00Z');
    const quiet = { timezone: 'UTC', start: 22 * 60, end: 7 * 60 };
    expect(deliverAfter(now, 'notice', quiet).toISOString()).toBe('2026-06-02T07:00:00.000Z');
    expect(deliverAfter(now, 'critical', quiet)).toEqual(now);
    expect(deliverAfter(now, 'notice', null)).toEqual(now);
  });
});

describe('notifications', () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
  });
  afterEach(async () => {
    await kit.close();
  });

  it('creates inbox rows, dedupes, and schedules DM delivery', async () => {
    const m = await kit.member();
    const input = {
      recipientUserId: m.userId,
      type: 'mission.assigned' as const,
      title: 'MISSION ASSIGNED',
      body: 'Build X',
      dedupeKey: 'mission:1',
    };
    expect(await notify(kit.system, input)).not.toBeNull();
    expect(await notify(kit.system, input)).toBeNull();
    const deliveryJobs = await kit.db
      .select()
      .from(jobs)
      .where(eq(jobs.type, 'notifications.deliver'));
    expect(deliveryJobs).toHaveLength(1);
    const inbox = await listMyNotifications(kit.as(m));
    expect(inbox.unread).toBe(1);
    expect(await markNotificationsRead(kit.as(m), 'all')).toBe(1);
    expect((await listMyNotifications(kit.as(m))).unread).toBe(0);
  });

  it('honours per-type opt-outs', async () => {
    const m = await kit.member();
    await updateMyPreferences(kit.as(m), {
      channels: [{ type: 'achievement.unlocked', channel: 'discord_dm', enabled: false }],
    });
    await notify(kit.system, {
      recipientUserId: m.userId,
      type: 'achievement.unlocked',
      title: 'A',
      body: 'B',
    });
    const [delivery] = await kit.db.select().from(notificationDeliveries);
    expect(delivery!.status).toBe('skipped');
    expect(
      await kit.db.select().from(jobs).where(eq(jobs.type, 'notifications.deliver')),
    ).toHaveLength(0);
  });

  it('defers during quiet hours', async () => {
    const m = await kit.member();
    await updateMyPreferences(kit.as(m), {
      timezone: 'UTC',
      quietHours: { start: 0, end: 23 * 60 + 59 },
    });
    await notify(kit.system, {
      recipientUserId: m.userId,
      type: 'mission.assigned',
      title: 'A',
      body: 'B',
    });
    const [delivery] = await kit.db.select().from(notificationDeliveries);
    expect(delivery!.status).toBe('deferred');
  });

  it('users can only read their own notifications', async () => {
    const a = await kit.member();
    const b = await kit.member();
    await notify(kit.system, {
      recipientUserId: a.userId,
      type: 'mission.assigned',
      title: 'A',
      body: 'B',
    });
    expect((await listMyNotifications(kit.as(b))).items).toHaveLength(0);
    expect(await markNotificationsRead(kit.as(b), 'all')).toBe(0);
  });

  it('rejects unknown timezones', async () => {
    const m = await kit.member();
    await expect(updateMyPreferences(kit.as(m), { timezone: 'Mars/Olympus' })).rejects.toThrow(
      'unknown timezone',
    );
  });
});
