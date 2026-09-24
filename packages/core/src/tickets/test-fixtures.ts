import { and, eq } from 'drizzle-orm';
import { auditLogs, jobs, notifications, ticketEvents } from '@jave/database';
import { systemActor, type UserActor } from '../permissions/actor';
import { updateSettings } from '../settings/settings.service';
import { createTestKit, type TestKit } from '../testing';
import { openTicket } from './lifecycle.service';
import type { OpenTicketInput } from './schemas';
import { markThreadCreated } from './thread.service';
import type { TicketSummary } from './views';

/**
 * TEST-ONLY fixtures for the tickets module. Never imported by production
 * code (not exported from the module index).
 */

/**
 * Integration suites run real SQL on PGlite, several statements per step. On
 * the shared build machine they can exceed the default 20 s under heavy load.
 */
export const INTEGRATION_SUITE = { timeout: 90_000 } as const;

export const TICKET_CHANNEL_ID = '300000000000000001';
export const ARCHIVE_CHANNEL_ID = '300000000000000002';

let snowflakeCounter = 400_000_000_000_000_000n;

/** Unique Discord-shaped ID for threads and messages in tests. */
export function nextSnowflake(): string {
  snowflakeCounter += 1n;
  return snowflakeCounter.toString();
}

/** Test kit with the ticket channels configured. */
export async function createTicketKit(): Promise<TestKit> {
  const kit = await createTestKit();
  await updateSettings(kit.system, 'channels', {
    tickets: TICKET_CHANNEL_ID,
    ticketArchive: ARCHIVE_CHANNEL_ID,
  });
  return kit;
}

/** Context of the bot's worker / gateway listener (system actor). */
export function botContext(kit: TestKit) {
  return kit.as(systemActor('test:bot'));
}

export async function openAs(
  kit: TestKit,
  actor: UserActor,
  overrides: Partial<OpenTicketInput> = {},
): Promise<TicketSummary> {
  return openTicket(kit.as(actor), {
    category: 'technical',
    subject: 'Deploy pipeline fails on build step',
    body: 'The build step exits with code 137 since yesterday. Logs attached in thread.',
    ...overrides,
  });
}

/** Simulate the bot completing discord.tickets.open_thread. Returns the thread id. */
export async function provisionThread(kit: TestKit, ticketId: string): Promise<string> {
  const threadId = nextSnowflake();
  await markThreadCreated(botContext(kit), {
    ticketId,
    threadId,
    cardMessageId: nextSnowflake(),
  });
  return threadId;
}

export function authorOf(actor: UserActor) {
  return { discordId: actor.discordId, username: actor.displayName };
}

export async function jobsOfType(kit: TestKit, type: string) {
  return kit.db.select().from(jobs).where(eq(jobs.type, type));
}

export async function auditOf(kit: TestKit, action: string, targetId?: string) {
  return kit.db
    .select()
    .from(auditLogs)
    .where(
      targetId
        ? and(eq(auditLogs.action, action), eq(auditLogs.targetId, targetId))
        : eq(auditLogs.action, action),
    );
}

export async function notificationsFor(kit: TestKit, userId: string) {
  return kit.db.select().from(notifications).where(eq(notifications.recipientUserId, userId));
}

export async function ticketEventTypes(kit: TestKit, ticketId: string): Promise<string[]> {
  const rows = await kit.db
    .select({ type: ticketEvents.type })
    .from(ticketEvents)
    .where(eq(ticketEvents.ticketId, ticketId))
    .orderBy(ticketEvents.seq);
  return rows.map((r) => r.type);
}
