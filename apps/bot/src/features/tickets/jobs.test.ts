import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, tickets as ticketsTable } from '@jave/database';
import { enqueueJob, HOUR, tickets, updateSettings } from '@jave/core';
import { DiscordActionError, type MessagePayload } from '../../discord/gateway';
import { customId } from '../../interactions/custom-id';
import type { BotHarness } from '../../testing/harness';
import { ACTION, DISCORD_ERROR, FIELD, TICKETS_NS } from './constants';
import { TRANSCRIPT_STEP_ERROR } from './jobs/close-thread';
import {
  ARCHIVE_CHANNEL_ID,
  HOOK_TIMEOUT,
  jobsOfType,
  openViaDiscord,
  person,
  postedTo,
  SUITE,
  TICKET_CHANNEL_ID,
  textOf,
  ticketBot,
  ticketRow,
} from './test-support';

const MISSING_PERMISSIONS = 50013;
const SERVER_ERROR = 500;
const THREAD_METHODS = ['sendMessage', 'editMessage', 'addThreadMember', 'setThreadState'];

function gone(code: number): DiscordActionError {
  return new DiscordActionError('unknown entity', code, true);
}

describe('tickets — Discord job handlers', SUITE, () => {
  let bot: BotHarness;
  beforeEach(async () => {
    bot = await ticketBot();
  }, HOOK_TIMEOUT);
  afterEach(async () => {
    await bot.close();
  }, HOOK_TIMEOUT);

  async function closeAs(
    user: Parameters<typeof bot.run>[0]['user'],
    ticketId: string,
    reason: string,
  ) {
    return bot.run({
      kind: 'modal',
      name: customId(TICKETS_NS, ACTION.close, ticketId),
      user,
      modalText: { [FIELD.reason]: reason },
    });
  }

  describe('open_thread', () => {
    it('a missing Discord permission dead-letters the job; the ticket stays usable', async () => {
      const requester = await person(bot, ['verified']);
      bot.gateway.failures.set(
        'createPrivateThread',
        new DiscordActionError(
          'create thread failed: Missing Permissions',
          MISSING_PERMISSIONS,
          true,
        ),
      );
      await bot.run({ kind: 'slash', name: 'ticket', subcommand: 'open', user: requester.user });
      const submit = await bot.run({
        kind: 'modal',
        name: customId(TICKETS_NS, ACTION.open, 'general'),
        user: requester.user,
        modalText: { [FIELD.subject]: 'Access question', [FIELD.body]: 'How do I join research?' },
        modalSelect: { [FIELD.priority]: ['low'] },
      });
      expect(submit.interaction.lastText()).toContain('TICKET #0001 OPENED');
      const [job] = await jobsOfType(bot, tickets.OPEN_THREAD_JOB);
      expect(job).toMatchObject({ status: 'dead' });
      expect(job!.lastError).toContain('Missing Permissions');
      const [row] = await bot.kit.db.select().from(ticketsTable);
      expect(row).toMatchObject({ status: 'open', discordThreadId: null });
    });

    it('a transient failure retries later and then provisions the thread', async () => {
      const requester = await person(bot, ['verified']);
      bot.gateway.failures.set(
        'createPrivateThread',
        new DiscordActionError('create thread failed: 500', SERVER_ERROR, false),
      );
      await openViaDiscord(bot, requester.user).catch(() => undefined);
      const [pending] = await jobsOfType(bot, tickets.OPEN_THREAD_JOB);
      expect(pending).toMatchObject({ status: 'pending', attempts: 1 });
      bot.kit.clock.advance(HOUR);
      await bot.drain();
      const [done] = await jobsOfType(bot, tickets.OPEN_THREAD_JOB);
      expect(done).toMatchObject({ status: 'completed' });
      expect(bot.gateway.callsTo('createPrivateThread')).toHaveLength(2);
    });

    it('re-running after success only ensures membership — no second thread', async () => {
      const requester = await person(bot, ['verified']);
      const ticket = await openViaDiscord(bot, requester.user);
      await enqueueJob(bot.kit.system, tickets.OPEN_THREAD_JOB, {
        ticketId: ticket.id,
        parentChannelId: TICKET_CHANNEL_ID,
        openerDiscordId: requester.actor.discordId,
        threadName: '#0001 · retry',
      });
      await bot.drain();
      expect(bot.gateway.callsTo('createPrivateThread')).toHaveLength(1);
      expect(bot.gateway.callsTo('addThreadMember').length).toBeGreaterThanOrEqual(2);
    });

    it('a recorded thread that Discord no longer has is replaced in the same run', async () => {
      const requester = await person(bot, ['verified']);
      const ticket = await openViaDiscord(bot, requester.user);
      bot.gateway.failures.set('addThreadMember', gone(DISCORD_ERROR.unknownChannel));
      await enqueueJob(bot.kit.system, tickets.OPEN_THREAD_JOB, {
        ticketId: ticket.id,
        parentChannelId: TICKET_CHANNEL_ID,
        openerDiscordId: requester.actor.discordId,
        threadName: '#0001 · again',
      });
      await bot.drain();
      const row = await ticketRow(bot, ticket.id);
      expect(row.discordThreadId).not.toBe(ticket.threadId);
      expect(row.discordThreadId).not.toBeNull();
      expect(bot.gateway.callsTo('createPrivateThread')).toHaveLength(2);
    });

    it('an opener who left the guild does not block the thread', async () => {
      const requester = await person(bot, ['verified']);
      bot.gateway.failures.set('addThreadMember', gone(DISCORD_ERROR.unknownMember));
      const ticket = await openViaDiscord(bot, requester.user);
      const [job] = await jobsOfType(bot, tickets.OPEN_THREAD_JOB);
      expect(job).toMatchObject({ status: 'completed' });
      expect(job!.result).toMatchObject({ status: 'created', openerAdded: false });
      expect(ticket.threadId).toBeTruthy();
    });

    it('malformed payloads dead-letter immediately', async () => {
      await enqueueJob(bot.kit.system, tickets.OPEN_THREAD_JOB, { ticketId: 'x', threadName: '' });
      await enqueueJob(bot.kit.system, tickets.UPDATE_CARD_JOB, { change: 'explode' });
      await bot.drain();
      const statuses = [
        ...(await jobsOfType(bot, tickets.OPEN_THREAD_JOB)),
        ...(await jobsOfType(bot, tickets.UPDATE_CARD_JOB)),
      ].map((job) => job.status);
      expect(statuses).toEqual(['dead', 'dead']);
    });
  });

  describe('update_card', () => {
    it('a deleted thread is reported to core and re-provisioned for the active ticket', async () => {
      const requester = await person(bot, ['verified']);
      const staff = await person(bot, ['moderator']);
      const ticket = await openViaDiscord(bot, requester.user);
      bot.gateway.channels.delete(ticket.threadId);
      bot.gateway.failures.set('editMessage', gone(DISCORD_ERROR.unknownChannel));
      await bot.run({
        kind: 'button',
        name: customId(TICKETS_NS, ACTION.claim, ticket.id),
        user: staff.user,
      });
      const row = await ticketRow(bot, ticket.id);
      expect(row.discordThreadId).not.toBe(ticket.threadId);
      expect(row.discordThreadId).not.toBeNull();
      const missing = await bot.kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'ticket.thread_missing'));
      expect(missing).toHaveLength(1);
      const card = bot.gateway.messages.get(row.discordCardMessageId!)!.payload;
      expect(textOf(card)).toContain('#0001 · CLAIMED');
    });

    it('a deleted card message is re-posted and recorded', async () => {
      const requester = await person(bot, ['verified']);
      const staff = await person(bot, ['moderator']);
      const ticket = await openViaDiscord(bot, requester.user);
      bot.gateway.messages.delete(ticket.cardMessageId);
      await bot.run({
        kind: 'button',
        name: customId(TICKETS_NS, ACTION.claim, ticket.id),
        user: staff.user,
      });
      const row = await ticketRow(bot, ticket.id);
      expect(row.discordThreadId).toBe(ticket.threadId);
      expect(row.discordCardMessageId).not.toBe(ticket.cardMessageId);
      expect(textOf(bot.gateway.messages.get(row.discordCardMessageId!)!.payload)).toContain(
        'CLAIMED',
      );
    });

    it('never touches Discord once the ticket is closed (late or retried jobs)', async () => {
      const requester = await person(bot, ['verified']);
      const ticket = await openViaDiscord(bot, requester.user);
      await closeAs(requester.user, ticket.id, 'Done here.');
      const before = bot.gateway.calls.length;
      await enqueueJob(bot.kit.system, tickets.UPDATE_CARD_JOB, {
        ticketId: ticket.id,
        change: 'refresh',
        note: null,
        assigneeUserId: null,
      });
      await bot.drain();
      const threadCalls = bot.gateway.calls
        .slice(before)
        .filter((call) => THREAD_METHODS.includes(call.method));
      expect(threadCalls).toEqual([]);
    });
  });

  describe('close_thread', () => {
    it('without an archive channel nothing is uploaded', async () => {
      await updateSettings(bot.kit.system, 'channels', { ticketArchive: undefined });
      const requester = await person(bot, ['verified']);
      const ticket = await openViaDiscord(bot, requester.user);
      await closeAs(requester.user, ticket.id, 'All good.');
      const [job] = await jobsOfType(bot, tickets.CLOSE_THREAD_JOB);
      expect(job!.result).toMatchObject({
        archive: { uploaded: false, reason: 'no archive channel' },
      });
      expect(postedTo(bot, ARCHIVE_CHANNEL_ID)).toHaveLength(0);
    });

    it('a thread deleted before the close still gets its transcript archived', async () => {
      const requester = await person(bot, ['verified']);
      const ticket = await openViaDiscord(bot, requester.user);
      bot.gateway.failures.set('sendMessage', gone(DISCORD_ERROR.unknownChannel));
      await closeAs(requester.user, ticket.id, 'Closing.');
      const [job] = await jobsOfType(bot, tickets.CLOSE_THREAD_JOB);
      expect(job).toMatchObject({ status: 'completed' });
      expect(job!.result).toMatchObject({ threadMissing: true, archive: { uploaded: true } });
      expect((await ticketRow(bot, ticket.id)).discordThreadId).toBeNull();
      expect(postedTo(bot, ARCHIVE_CHANNEL_ID)).toHaveLength(1);
    });

    it('a transient upload failure retries the upload without a second closing card', async () => {
      const requester = await person(bot, ['verified']);
      const ticket = await openViaDiscord(bot, requester.user);
      const send = bot.gateway.sendMessage.bind(bot.gateway);
      let failedOnce = false;
      bot.gateway.sendMessage = async (channelId: string, payload: MessagePayload) => {
        if (channelId === ARCHIVE_CHANNEL_ID && !failedOnce) {
          failedOnce = true;
          throw new DiscordActionError('upload failed: 500', SERVER_ERROR, false);
        }
        return send(channelId, payload);
      };
      await closeAs(requester.user, ticket.id, 'Resolved.');
      const [failed] = await jobsOfType(bot, tickets.CLOSE_THREAD_JOB);
      expect(failed).toMatchObject({ status: 'pending' });
      expect(failed!.lastError).toContain(TRANSCRIPT_STEP_ERROR);
      bot.kit.clock.advance(HOUR);
      await bot.drain();
      const [done] = await jobsOfType(bot, tickets.CLOSE_THREAD_JOB);
      expect(done).toMatchObject({ status: 'completed' });
      const closingCards = postedTo(bot, ticket.threadId).filter((m) =>
        textOf(m).includes('#0001 · CLOSED'),
      );
      expect(closingCards).toHaveLength(1);
      expect(postedTo(bot, ARCHIVE_CHANNEL_ID)).toHaveLength(1);
    });

    it('a missing archive permission dead-letters after the thread is closed', async () => {
      const requester = await person(bot, ['verified']);
      const ticket = await openViaDiscord(bot, requester.user);
      const send = bot.gateway.sendMessage.bind(bot.gateway);
      bot.gateway.sendMessage = async (channelId: string, payload: MessagePayload) => {
        if (channelId === ARCHIVE_CHANNEL_ID) {
          throw new DiscordActionError(
            'send message failed: Missing Permissions',
            MISSING_PERMISSIONS,
            true,
          );
        }
        return send(channelId, payload);
      };
      await closeAs(requester.user, ticket.id, 'Resolved.');
      const [job] = await jobsOfType(bot, tickets.CLOSE_THREAD_JOB);
      expect(job).toMatchObject({ status: 'dead' });
      expect(bot.gateway.channels.get(ticket.threadId)).toMatchObject({
        locked: true,
        archived: true,
      });
    });

    it('a close superseded by a reopen does nothing', async () => {
      const requester = await person(bot, ['verified']);
      const ticket = await openViaDiscord(bot, requester.user);
      await enqueueJob(bot.kit.system, tickets.CLOSE_THREAD_JOB, {
        ticketId: ticket.id,
        threadId: ticket.threadId,
        archiveChannelId: ARCHIVE_CHANNEL_ID,
      });
      await bot.drain();
      const [job] = await jobsOfType(bot, tickets.CLOSE_THREAD_JOB);
      expect(job!.result).toEqual({ skipped: 'reopened since' });
      expect(bot.gateway.callsTo('setThreadState')).toHaveLength(0);
    });
  });

  describe('reopen_thread', () => {
    it('a thread deleted while closed is re-provisioned on reopen', async () => {
      const requester = await person(bot, ['verified']);
      const ticket = await openViaDiscord(bot, requester.user);
      await closeAs(requester.user, ticket.id, 'Done.');
      bot.gateway.channels.delete(ticket.threadId);
      bot.gateway.failures.set('setThreadState', gone(DISCORD_ERROR.unknownChannel));
      await bot.run({
        kind: 'modal',
        name: customId(TICKETS_NS, ACTION.reopen, ticket.id),
        user: requester.user,
        modalText: { [FIELD.reason]: 'Not done after all.' },
      });
      const row = await ticketRow(bot, ticket.id);
      expect(row.status).toBe('open');
      expect(row.discordThreadId).not.toBe(ticket.threadId);
      expect(row.discordThreadId).not.toBeNull();
      const card = bot.gateway.messages.get(row.discordCardMessageId!)!.payload;
      expect(textOf(card)).toContain('#0001 · OPEN');
    });
  });
});
