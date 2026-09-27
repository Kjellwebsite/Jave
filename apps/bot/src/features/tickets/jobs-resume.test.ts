import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { jobs } from '@jave/database';
import {
  enqueueJob,
  HOUR,
  InvalidStateError,
  NotFoundError,
  PermanentJobError,
  tickets,
} from '@jave/core';
import { DiscordActionError, type MessagePayload } from '../../discord/gateway';
import { customId } from '../../interactions/custom-id';
import type { BotHarness } from '../../testing/harness';
import { ACTION, FIELD, THREAD_AUTO_ARCHIVE_MINUTES, TICKETS_NS } from './constants';
import { failAt, namedStep } from './jobs/close-thread';
import {
  ARCHIVE_CHANNEL_ID,
  HOOK_TIMEOUT,
  jobsOfType,
  messageState,
  openViaDiscord,
  person,
  postedTo,
  SUITE,
  TICKET_CHANNEL_ID,
  textOf,
  ticketBot,
  ticketRow,
} from './test-support';

const SERVER_ERROR = 500;
const LEASE_RECOVERED = 'recovered: worker lease expired';
const THREAD_METHODS = [
  'createPrivateThread',
  'sendMessage',
  'editMessage',
  'addThreadMember',
  'setThreadState',
];

/**
 * Ticket threads that archived themselves while idle, and close jobs resumed
 * after failures the step bookkeeping cannot see (a crashed worker).
 */
describe('tickets — idle threads and resumed closes', SUITE, () => {
  let bot: BotHarness;
  beforeEach(async () => {
    bot = await ticketBot();
  }, HOOK_TIMEOUT);
  afterEach(async () => {
    await bot.close();
  }, HOOK_TIMEOUT);

  /** What Discord does to a thread nobody wrote in for the auto-archive period. */
  function idle(threadId: string) {
    const thread = bot.gateway.channels.get(threadId);
    if (!thread) throw new Error('thread not found');
    thread.archived = true;
  }

  function closingCards(threadId: string, reference: string) {
    return postedTo(bot, threadId).filter((m) => textOf(m).includes(`${reference} · CLOSED`));
  }

  async function closeAs(user: Parameters<typeof bot.run>[0]['user'], ticketId: string) {
    return bot.run({
      kind: 'modal',
      name: customId(TICKETS_NS, ACTION.close, ticketId),
      user,
      modalText: { [FIELD.reason]: 'Resolved in the meantime.' },
    });
  }

  it('threads are created to archive after a week of silence, the longest Discord allows', async () => {
    const requester = await person(bot, ['verified']);
    await openViaDiscord(bot, requester.user);
    const [call] = bot.gateway.callsTo('createPrivateThread');
    expect(call!.args[1]).toMatchObject({ autoArchiveMinutes: THREAD_AUTO_ARCHIVE_MINUTES });
  });

  it('closing an idle thread unarchives it, finalizes, locks and archives the transcript', async () => {
    const requester = await person(bot, ['verified']);
    const ticket = await openViaDiscord(bot, requester.user);
    idle(ticket.threadId);

    await closeAs(requester.user, ticket.id);
    const [job] = await jobsOfType(bot, tickets.CLOSE_THREAD_JOB);
    expect(job).toMatchObject({ status: 'completed', attempts: 1 });
    expect(textOf(messageState(bot, ticket.cardMessageId))).toContain('#0001 · CLOSED');
    expect(closingCards(ticket.threadId, '#0001')).toHaveLength(1);
    expect(bot.gateway.channels.get(ticket.threadId)).toMatchObject({
      locked: true,
      archived: true,
    });
    expect(postedTo(bot, ARCHIVE_CHANNEL_ID)).toHaveLength(1);
    const unarchived = bot.gateway
      .callsTo('setThreadState')
      .filter((call) => (call.args[1] as { archived?: boolean }).archived === false);
    expect(unarchived).toHaveLength(1);
  });

  it('claiming and waiting on an idle thread still update the card, add the handler and announce', async () => {
    const requester = await person(bot, ['verified']);
    const staff = await person(bot, ['moderator'], 'handler_one');
    const ticket = await openViaDiscord(bot, requester.user);
    idle(ticket.threadId);

    await bot.run({
      kind: 'button',
      name: customId(TICKETS_NS, ACTION.claim, ticket.id),
      user: staff.user,
    });
    const thread = bot.gateway.channels.get(ticket.threadId)!;
    expect(thread.members.has(staff.user.id)).toBe(true);
    expect(textOf(messageState(bot, ticket.cardMessageId))).toContain('#0001 · CLAIMED');
    expect(postedTo(bot, ticket.threadId).some((m) => textOf(m).includes('CLAIMED'))).toBe(true);

    idle(ticket.threadId);
    await bot.run({
      kind: 'modal',
      name: customId(TICKETS_NS, ACTION.waiting, ticket.id),
      user: staff.user,
      modalText: { [FIELD.reason]: 'Send the full build log, please.' },
    });
    expect(postedTo(bot, ticket.threadId).some((m) => textOf(m).includes('WAITING ON YOU'))).toBe(
      true,
    );
    expect(textOf(messageState(bot, ticket.cardMessageId))).toContain('#0001 · WAITING');
    const updates = await jobsOfType(bot, tickets.UPDATE_CARD_JOB);
    expect(updates.map((job) => job.status)).toEqual(updates.map(() => 'completed'));
  });

  it('a worker that died after the lock resumes at the transcript: one closing card', async () => {
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
    await closeAs(requester.user, ticket.id);
    const [failed] = await jobsOfType(bot, tickets.CLOSE_THREAD_JOB);
    expect(failed).toMatchObject({ status: 'pending' });
    // What recoverStaleJobs leaves behind when the worker dies mid-upload.
    await bot.kit.db
      .update(jobs)
      .set({ lastError: LEASE_RECOVERED })
      .where(eq(jobs.id, failed!.id));

    bot.kit.clock.advance(HOUR);
    await bot.drain();
    const [done] = await jobsOfType(bot, tickets.CLOSE_THREAD_JOB);
    expect(done).toMatchObject({ status: 'completed' });
    expect(done!.result).toMatchObject({ resumedAt: 'transcript', archive: { uploaded: true } });
    expect(bot.gateway.callsTo('fetchThreadState')).toHaveLength(1);
    expect(closingCards(ticket.threadId, '#0001')).toHaveLength(1);
    expect(bot.gateway.channels.get(ticket.threadId)).toMatchObject({
      locked: true,
      archived: true,
    });
  });

  it('a worker that died before the lock runs the close again from the start', async () => {
    const requester = await person(bot, ['verified']);
    const ticket = await openViaDiscord(bot, requester.user);
    bot.gateway.failures.set(
      'editMessage',
      new DiscordActionError('edit message failed: 503', SERVER_ERROR, false),
    );
    await closeAs(requester.user, ticket.id);
    const [failed] = await jobsOfType(bot, tickets.CLOSE_THREAD_JOB);
    expect(namedStep(failed!)).toBe('finalize');
    await bot.kit.db
      .update(jobs)
      .set({ lastError: LEASE_RECOVERED })
      .where(eq(jobs.id, failed!.id));

    bot.kit.clock.advance(HOUR);
    await bot.drain();
    const [done] = await jobsOfType(bot, tickets.CLOSE_THREAD_JOB);
    expect(done!.result).toMatchObject({ resumedAt: 'finalize', archive: { uploaded: true } });
    expect(closingCards(ticket.threadId, '#0001')).toHaveLength(1);
  });

  it('a thread deleted before an unnamed retry is reported and the transcript still goes out', async () => {
    const requester = await person(bot, ['verified']);
    const ticket = await openViaDiscord(bot, requester.user);
    bot.gateway.failures.set(
      'editMessage',
      new DiscordActionError('edit message failed: 503', SERVER_ERROR, false),
    );
    await closeAs(requester.user, ticket.id);
    const [failed] = await jobsOfType(bot, tickets.CLOSE_THREAD_JOB);
    await bot.kit.db
      .update(jobs)
      .set({ lastError: LEASE_RECOVERED })
      .where(eq(jobs.id, failed!.id));
    bot.gateway.channels.delete(ticket.threadId);

    bot.kit.clock.advance(HOUR);
    await bot.drain();
    const [done] = await jobsOfType(bot, tickets.CLOSE_THREAD_JOB);
    expect(done).toMatchObject({ status: 'completed' });
    expect(done!.result).toMatchObject({ threadMissing: true, archive: { uploaded: true } });
    expect((await ticketRow(bot, ticket.id)).discordThreadId).toBeNull();
  });

  it("a re-run of open_thread leaves a closed ticket's locked thread alone", async () => {
    const requester = await person(bot, ['verified']);
    const ticket = await openViaDiscord(bot, requester.user);
    await closeAs(requester.user, ticket.id);
    const before = bot.gateway.calls.length;
    await enqueueJob(bot.kit.system, tickets.OPEN_THREAD_JOB, {
      ticketId: ticket.id,
      parentChannelId: TICKET_CHANNEL_ID,
      openerDiscordId: requester.actor.discordId,
      threadName: '#0001 · late retry',
    });
    await bot.drain();
    const threadCalls = bot.gateway.calls
      .slice(before)
      .filter((call) => THREAD_METHODS.includes(call.method));
    expect(threadCalls).toEqual([]);
    expect(bot.gateway.channels.get(ticket.threadId)).toMatchObject({
      locked: true,
      archived: true,
    });
  });

  it('every failure keeps the step it happened in, and only final ones dead-letter', () => {
    const transient = failAt('lock', new Error('connection terminated'));
    expect(transient).not.toBeInstanceOf(PermanentJobError);
    expect(namedStep({ lastError: transient.message })).toBe('lock');

    const gone = failAt('finalize', new NotFoundError('Ticket'));
    expect(gone).toBeInstanceOf(PermanentJobError);
    expect(namedStep({ lastError: gone.message })).toBe('finalize');
    expect(failAt('lock', new InvalidStateError('x'))).toBeInstanceOf(PermanentJobError);
    expect(
      failAt('transcript', new DiscordActionError('missing access', 50001, true)),
    ).toBeInstanceOf(PermanentJobError);

    const unknown = new Error('socket hang up');
    expect(failAt(null, unknown)).toBe(unknown);
    expect(namedStep({ lastError: failAt(null, unknown).message })).toBeNull();
  });
});
