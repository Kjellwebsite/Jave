import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, like } from 'drizzle-orm';
import { jobs, tickets } from '@jave/database';
import {
  grantRole,
  HOUR,
  listJobs,
  MINUTE,
  retryDeadJob,
  updateSettings,
  type UserActor,
} from '@jave/core';
import { DiscordActionError } from '../discord/gateway';
import { ACTION, FIELD, TICKETS_NS } from '../features/tickets/constants';
import {
  HOOK_TIMEOUT,
  person,
  SUITE,
  ticketBot,
  ticketRow,
} from '../features/tickets/test-support';
import { customId } from '../interactions/custom-id';
import type { InteractionUser } from '../interactions/types';
import type { BotHarness } from '../testing/harness';

/**
 * GAUNTLET: Discord goes down. Members and staff keep working (JAVE is the
 * source of truth); every Discord side effect waits in the queue with
 * backoff, and once Discord is back the guild converges on JAVE's state —
 * each effect applied exactly once. An outage longer than the retry budget
 * leaves dead letters that a retry after recovery completes (RUNBOOK.md).
 */

const VERIFIED_ROLE = '500000000000000002';
/** How Discord answers during an outage: transient, so jobs retry. */
const unavailable = () => new DiscordActionError('Service Unavailable', null, false);

describe('GAUNTLET: a Discord outage', SUITE, () => {
  let bot: BotHarness;
  let founder: UserActor;

  beforeEach(async () => {
    bot = await ticketBot();
    founder = (await bot.member({ roles: ['founder'] })).actor;
    await updateSettings(bot.kit.as(founder), 'roles', {
      discordRoleIds: { verified: VERIFIED_ROLE },
    });
    await bot.drain();
  }, HOOK_TIMEOUT);
  afterEach(async () => {
    await bot.close();
  }, HOOK_TIMEOUT);

  /** Let time pass while the worker keeps trying. */
  async function passTime(ms: number, rounds = 1) {
    for (let i = 0; i < rounds; i++) {
      bot.kit.clock.advance(ms);
      await bot.drain();
    }
  }

  const discordJobs = (status: 'pending' | 'dead' | 'completed') =>
    bot.kit.db
      .select()
      .from(jobs)
      .where(and(like(jobs.type, 'discord.%'), eq(jobs.status, status)));
  /** /ticket open → category → form, as a member would; returns the ticket id. */
  async function openTicket(user: InteractionUser, userId: string): Promise<string> {
    await bot.run({ kind: 'slash', name: 'ticket', subcommand: 'open', user });
    await bot.run({
      kind: 'select',
      name: customId(TICKETS_NS, ACTION.category),
      user,
      values: ['general'],
    });
    const submitted = await bot.run({
      kind: 'modal',
      name: customId(TICKETS_NS, ACTION.open, 'general'),
      user,
      modalText: { [FIELD.subject]: 'Staging access', [FIELD.body]: 'Our team needs staging.' },
      modalSelect: { [FIELD.priority]: ['normal'] },
    });
    expect(submitted.interaction.lastText()).toContain('OPENED');
    const [row] = await bot.kit.db.select().from(tickets).where(eq(tickets.openerUserId, userId));
    return row!.id;
  }
  const threads = () => [...bot.gateway.channels.values()].filter((channel) => channel.thread);

  it('work done during the outage reaches Discord once it recovers, exactly once', async () => {
    const requester = await person(bot, ['member'], 'nova');
    const promoted = await person(bot, ['member'], 'orbit');
    await bot.drain();
    const threadsBefore = threads().length;

    bot.gateway.outage = unavailable();
    const health = await bot.app.services.health();
    expect(health.checks.find((check) => check.name === 'discord')?.status).toBe('down');

    // A member opens a ticket: JAVE records it and answers, Discord waits.
    const ticketId = await openTicket(requester.user, requester.actor.userId);
    expect((await ticketRow(bot, ticketId)).discordThreadId).toBeNull();
    // Staff promote someone on the dashboard: the role waits for Discord.
    await grantRole(bot.kit.as(founder), {
      memberId: promoted.actor.memberId!,
      role: 'verified',
      reason: 'Passed verification.',
    });
    await bot.drain();

    // Several minutes of outage: retries back off, nothing is given up yet.
    await passTime(MINUTE, 2);
    expect(await discordJobs('dead')).toEqual([]);
    const waiting = await discordJobs('pending');
    expect(waiting.map((job) => job.type)).toEqual(
      expect.arrayContaining(['discord.tickets.open_thread', 'discord.roles.sync']),
    );
    expect(waiting.every((job) => job.attempts >= 1)).toBe(true);

    // Discord is back.
    bot.gateway.outage = null;
    await passTime(HOUR);

    expect(await discordJobs('dead')).toEqual([]);
    expect(await discordJobs('pending')).toEqual([]);
    expect((await ticketRow(bot, ticketId)).discordThreadId).not.toBeNull();
    expect(threads()).toHaveLength(threadsBefore + 1);
    expect(bot.gateway.members.get(promoted.actor.discordId)!.roleIds).toContain(VERIFIED_ROLE);
    const healthAfter = await bot.app.services.health();
    expect(healthAfter.checks.find((check) => check.name === 'discord')?.status).toBe('ok');
  });

  it('an outage longer than the retry budget dead-letters; a retry after recovery completes it', async () => {
    const requester = await person(bot, ['member'], 'lyra');
    await bot.drain();
    bot.gateway.outage = unavailable();
    const ticketId = await openTicket(requester.user, requester.actor.userId);
    // Hours of outage exhaust every attempt.
    await passTime(HOUR, 8);
    const [dead] = await discordJobs('dead');
    expect(dead?.type).toBe('discord.tickets.open_thread');
    const listed = await listJobs(bot.kit.as(founder), { status: 'dead', limit: 10 });
    expect(listed.items.map((job) => job.id)).toContain(dead!.id);

    bot.gateway.outage = null;
    await retryDeadJob(bot.kit.as(founder), { jobId: dead!.id });
    await passTime(MINUTE);

    expect(await discordJobs('dead')).toEqual([]);
    expect((await ticketRow(bot, ticketId)).discordThreadId).not.toBeNull();
  });
});
