import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { domainEvents, ticketMessages, tickets } from '@jave/database';
import { DAY, HOUR, MINUTE } from '../kernel/clock';
import { ConflictError, DisabledError, InvalidStateError } from '../kernel/errors';
import { revokeRole } from '../identity/roles.service';
import { updateSettings } from '../settings/settings.service';
import type { TestKit } from '../testing';
import {
  claimTicket,
  resumeTicket,
  setPriority,
  setWaiting,
  transferTicket,
  unclaimTicket,
} from './assignment.service';
import {
  CLOSE_THREAD_JOB,
  OPEN_THREAD_JOB,
  parseTicketDiscordJobPayload,
  REOPEN_THREAD_JOB,
  UPDATE_CARD_JOB,
} from './discord-jobs';
import { archiveTicket, closeTicket, openTicket, reopenTicket } from './lifecycle.service';
import { recordMessage } from './messages.service';
import { runArchiveSweep } from './sweeps';
import { getTicket } from './queries.service';
import {
  ARCHIVE_CHANNEL_ID,
  auditOf,
  authorOf,
  botContext,
  createTicketKit,
  INTEGRATION_SUITE,
  jobsOfType,
  nextSnowflake,
  notificationsFor,
  openAs,
  provisionThread,
  TICKET_CHANNEL_ID,
  ticketEventTypes,
} from './test-fixtures';
import { markThreadCreated, markThreadMissing } from './thread.service';

describe('tickets: lifecycle', INTEGRATION_SUITE, () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTicketKit();
  });
  afterEach(async () => {
    await kit.close();
  });

  it('opens a ticket with first message, SLA, event and thread job', async () => {
    const member = await kit.member({ roles: ['verified'] });
    const ticket = await openAs(kit, member, { priority: 'normal' });
    expect(ticket.status).toBe('open');
    expect(ticket.reference).toMatch(/^#\d{4}$/);
    expect(ticket.sla).toBeNull(); // requester view

    const [row] = await kit.db.select().from(tickets).where(eq(tickets.id, ticket.id));
    expect(row!.slaFirstResponseDueAt!.getTime() - row!.createdAt.getTime()).toBe(1440 * MINUTE);
    expect(row!.discordChannelId).toBe(TICKET_CHANNEL_ID);

    const messages = await kit.db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.ticketId, ticket.id));
    expect(messages).toHaveLength(1);
    expect(messages[0]!.authorRole).toBe('requester');
    expect(messages[0]!.isInternal).toBe(false);

    const [opened] = await kit.db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.type, 'ticket.opened'));
    expect(opened!.subjectMemberId).toBe(member.memberId);

    const [job] = await jobsOfType(kit, OPEN_THREAD_JOB);
    const payload = parseTicketDiscordJobPayload(OPEN_THREAD_JOB, job!.payload);
    expect(payload).toMatchObject({
      ticketId: ticket.id,
      parentChannelId: TICKET_CHANNEL_ID,
      openerDiscordId: member.discordId,
    });
    expect(payload.threadName.startsWith(ticket.reference)).toBe(true);
    expect(await ticketEventTypes(kit, ticket.id)).toEqual(['created']);
  });

  it('alerts handlers for urgent tickets, never the opener', async () => {
    const mod = await kit.member({ roles: ['moderator'] });
    const ops = await kit.member({ roles: ['operations'] });
    const member = await kit.member();
    await openAs(kit, member, { priority: 'urgent' });
    expect((await notificationsFor(kit, mod.userId)).map((n) => n.type)).toEqual([
      'ticket.attention',
    ]);
    expect(await notificationsFor(kit, ops.userId)).toHaveLength(1);
    expect(await notificationsFor(kit, member.userId)).toHaveLength(0);
  });

  it('does not alert handlers for normal priority', async () => {
    const mod = await kit.member({ roles: ['moderator'] });
    await openAs(kit, await kit.member());
    expect(await notificationsFor(kit, mod.userId)).toHaveLength(0);
  });

  it('refuses when tickets are disabled or no channel is configured', async () => {
    const member = await kit.member();
    await updateSettings(kit.system, 'tickets', { enabled: false });
    await expect(openAs(kit, member)).rejects.toBeInstanceOf(DisabledError);
    await updateSettings(kit.system, 'tickets', { enabled: true });
    await updateSettings(kit.system, 'channels', { tickets: undefined });
    await expect(openAs(kit, member)).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('enforces maxOpenPerUser, counting only active tickets', async () => {
    const member = await kit.member();
    await updateSettings(kit.system, 'tickets', { maxOpenPerUser: 2 });
    const first = await openAs(kit, member);
    await openAs(kit, member);
    await expect(openAs(kit, member)).rejects.toBeInstanceOf(ConflictError);
    await closeTicket(kit.as(member), { ticketId: first.id, reason: 'Solved it myself.' });
    await expect(openAs(kit, member)).resolves.toMatchObject({ status: 'open' });
  });

  it('runs the full lifecycle: claim → waiting → reply → close → reopen → close → archive', async () => {
    const member = await kit.member({ roles: ['verified'] });
    const mod = await kit.member({ roles: ['moderator'] });
    const ticket = await openAs(kit, member);
    const threadId = await provisionThread(kit, ticket.id);

    const claimed = await claimTicket(kit.as(mod), { ticketId: ticket.id });
    expect(claimed.status).toBe('claimed');
    expect(claimed.assignee?.userId).toBe(mod.userId);
    expect((await auditOf(kit, 'ticket.claimed', ticket.id)).length).toBe(1);
    const claimNotice = await notificationsFor(kit, member.userId);
    expect(claimNotice.map((n) => n.title)).toEqual([`TICKET ${ticket.reference} — CLAIMED`]);

    kit.clock.advance(10 * MINUTE);
    const waiting = await setWaiting(kit.as(mod), {
      ticketId: ticket.id,
      reason: 'Please share the full build log.',
    });
    expect(waiting.status).toBe('waiting');
    expect(waiting.sla?.firstResponseAt).not.toBeNull();
    const cardJobs = await jobsOfType(kit, UPDATE_CARD_JOB);
    const waitingJob = cardJobs
      .map((j) => parseTicketDiscordJobPayload(UPDATE_CARD_JOB, j.payload))
      .find((p) => p.change === 'waiting');
    expect(waitingJob?.note).toBe('Please share the full build log.');

    kit.clock.advance(5 * MINUTE);
    const reply = await recordMessage(botContext(kit), {
      threadId,
      discordMessageId: nextSnowflake(),
      author: authorOf(member),
      body: 'Here is the log.',
    });
    expect(reply.resumed).toBe(true);
    const afterReply = await getTicket(kit.as(mod), { ticketId: ticket.id });
    expect(afterReply.status).toBe('claimed');

    const closed = await closeTicket(kit.as(mod), {
      ticketId: ticket.id,
      reason: 'Fixed by raising the memory limit.',
    });
    expect(closed.status).toBe('closed');
    const [closeJob] = await jobsOfType(kit, CLOSE_THREAD_JOB);
    expect(parseTicketDiscordJobPayload(CLOSE_THREAD_JOB, closeJob!.payload)).toEqual({
      ticketId: ticket.id,
      threadId,
      archiveChannelId: ARCHIVE_CHANNEL_ID,
    });

    const reopened = await reopenTicket(kit.as(member), {
      ticketId: ticket.id,
      reason: 'It broke again after redeploy.',
    });
    expect(reopened.status).toBe('claimed');
    const [reopenJob] = await jobsOfType(kit, REOPEN_THREAD_JOB);
    expect(parseTicketDiscordJobPayload(REOPEN_THREAD_JOB, reopenJob!.payload).threadId).toBe(
      threadId,
    );
    // The opener reopened: the assignee is told, the opener is not notified about themselves.
    const modNotices = await notificationsFor(kit, mod.userId);
    expect(modNotices.some((n) => n.title === `TICKET ${ticket.reference} — REOPENED`)).toBe(true);

    await closeTicket(kit.as(member), { ticketId: ticket.id, reason: 'Works now, thanks.' });
    expect(await jobsOfType(kit, CLOSE_THREAD_JOB)).toHaveLength(2);

    kit.clock.advance(8 * DAY);
    const swept = await runArchiveSweep(botContext(kit));
    expect(swept.archived).toEqual([ticket.id]);
    const final = await getTicket(kit.as(mod), { ticketId: ticket.id });
    expect(final.status).toBe('archived');
    expect(final.reopenCount).toBe(1);
    await expect(
      reopenTicket(kit.as(member), { ticketId: ticket.id, reason: 'Again please' }),
    ).rejects.toBeInstanceOf(InvalidStateError);
    expect(await ticketEventTypes(kit, ticket.id)).toEqual([
      'created',
      'claimed',
      'status_changed',
      'status_changed',
      'closed',
      'reopened',
      'closed',
      'archived',
    ]);
  });

  it('reopen drops an assignee who can no longer handle tickets', async () => {
    const member = await kit.member();
    const mod = await kit.member({ roles: ['moderator'] });
    const core = await kit.member({ roles: ['core'] });
    const ticket = await openAs(kit, member);
    await claimTicket(kit.as(mod), { ticketId: ticket.id });
    await closeTicket(kit.as(mod), { ticketId: ticket.id, reason: 'Resolved in thread.' });
    await revokeRole(kit.as(core), {
      memberId: mod.memberId!,
      role: 'moderator',
      reason: 'rotation',
    });
    const reopened = await reopenTicket(kit.as(member), {
      ticketId: ticket.id,
      reason: 'Came back after the update.',
    });
    expect(reopened.status).toBe('open');
    expect(reopened.assignee).toBeNull();
  });

  it('archive sweep respects archiveAfterDays exactly', async () => {
    const member = await kit.member();
    const ticket = await openAs(kit, member);
    await closeTicket(kit.as(member), { ticketId: ticket.id, reason: 'Done here.' });
    kit.clock.advance(7 * DAY);
    expect((await runArchiveSweep(botContext(kit))).archived).toEqual([]);
    kit.clock.advance(1);
    expect((await runArchiveSweep(botContext(kit))).archived).toEqual([ticket.id]);
    expect((await runArchiveSweep(botContext(kit))).archived).toEqual([]);
  });

  it('manual archive requires a closed ticket and a ticket manager', async () => {
    const member = await kit.member();
    const ops = await kit.member({ roles: ['operations'] });
    const ticket = await openAs(kit, member);
    await expect(archiveTicket(kit.as(ops), { ticketId: ticket.id })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
    await closeTicket(kit.as(ops), { ticketId: ticket.id, reason: 'Duplicate of #0001.' });
    const archived = await archiveTicket(kit.as(ops), { ticketId: ticket.id });
    expect(archived.status).toBe('archived');
    expect(await auditOf(kit, 'ticket.archived', ticket.id)).toHaveLength(1);
  });

  it('transfers between handlers and notifies the new assignee', async () => {
    const member = await kit.member();
    const modA = await kit.member({ roles: ['moderator'] });
    const modB = await kit.member({ roles: ['moderator'] });
    const ticket = await openAs(kit, member);
    await claimTicket(kit.as(modA), { ticketId: ticket.id });
    const moved = await transferTicket(kit.as(modA), {
      ticketId: ticket.id,
      toUserId: modB.userId,
      reason: 'Owns the deploy tooling.',
    });
    expect(moved.assignee?.userId).toBe(modB.userId);
    expect(moved.status).toBe('claimed');
    const notices = await notificationsFor(kit, modB.userId);
    expect(notices.map((n) => n.title)).toEqual([`TICKET ${ticket.reference} — ASSIGNED TO YOU`]);
    expect(await auditOf(kit, 'ticket.transferred', ticket.id)).toHaveLength(1);
    const [event] = await kit.db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.type, 'ticket.transferred'));
    expect(event!.subjectMemberId).toBe(modB.memberId);
  });

  it('manager can assign an unassigned ticket and unclaim someone else', async () => {
    const member = await kit.member();
    const mod = await kit.member({ roles: ['moderator'] });
    const ops = await kit.member({ roles: ['operations'] });
    const ticket = await openAs(kit, member);
    await transferTicket(kit.as(ops), { ticketId: ticket.id, toUserId: mod.userId });
    const released = await unclaimTicket(kit.as(ops), { ticketId: ticket.id });
    expect(released.status).toBe('open');
    expect(released.assignee).toBeNull();
    const modNotices = await notificationsFor(kit, mod.userId);
    expect(modNotices.map((n) => n.title)).toContain(`TICKET ${ticket.reference} — UNASSIGNED`);
  });

  it('claim is idempotent for the same handler and conflicts for another', async () => {
    const member = await kit.member();
    const modA = await kit.member({ roles: ['moderator'] });
    const modB = await kit.member({ roles: ['moderator'] });
    const ticket = await openAs(kit, member);
    await claimTicket(kit.as(modA), { ticketId: ticket.id });
    await claimTicket(kit.as(modA), { ticketId: ticket.id });
    expect(await auditOf(kit, 'ticket.claimed', ticket.id)).toHaveLength(1);
    await expect(claimTicket(kit.as(modB), { ticketId: ticket.id })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('waiting on an unassigned ticket returns to open; resume works for handlers', async () => {
    const member = await kit.member();
    const mod = await kit.member({ roles: ['moderator'] });
    const ticket = await openAs(kit, member);
    await setWaiting(kit.as(mod), { ticketId: ticket.id, reason: 'Which browser?' });
    await expect(
      setWaiting(kit.as(mod), { ticketId: ticket.id, reason: 'Again?' }),
    ).rejects.toBeInstanceOf(InvalidStateError);
    const resumed = await resumeTicket(kit.as(mod), { ticketId: ticket.id });
    expect(resumed.status).toBe('open');
    await expect(resumeTicket(kit.as(mod), { ticketId: ticket.id })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
  });

  it('closing before the thread exists schedules the close once the thread appears', async () => {
    const member = await kit.member();
    const ticket = await openAs(kit, member);
    await closeTicket(kit.as(member), { ticketId: ticket.id, reason: 'Never mind.' });
    expect(await jobsOfType(kit, CLOSE_THREAD_JOB)).toHaveLength(0);
    const threadId = nextSnowflake();
    const result = await markThreadCreated(botContext(kit), { ticketId: ticket.id, threadId });
    expect(result).toEqual({ status: 'recorded', closeScheduled: true });
    expect(await jobsOfType(kit, CLOSE_THREAD_JOB)).toHaveLength(1);
  });

  it('markThreadCreated is idempotent and refuses a second thread', async () => {
    const member = await kit.member();
    const ticket = await openAs(kit, member);
    const threadId = nextSnowflake();
    await markThreadCreated(botContext(kit), { ticketId: ticket.id, threadId });
    await expect(
      markThreadCreated(botContext(kit), { ticketId: ticket.id, threadId }),
    ).resolves.toEqual({ status: 'unchanged' });
    await expect(
      markThreadCreated(botContext(kit), { ticketId: ticket.id, threadId: nextSnowflake() }),
    ).rejects.toBeInstanceOf(ConflictError);
    const other = await openAs(kit, member);
    await expect(
      markThreadCreated(botContext(kit), { ticketId: other.id, threadId }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('a missing thread is re-provisioned for an active ticket', async () => {
    const member = await kit.member();
    const ticket = await openAs(kit, member);
    await kit.drain({ [OPEN_THREAD_JOB]: async () => ({ simulated: true }) });
    const threadId = await provisionThread(kit, ticket.id);
    const stale = await markThreadMissing(botContext(kit), {
      ticketId: ticket.id,
      threadId: nextSnowflake(),
    });
    expect(stale).toEqual({ status: 'ignored' });
    const result = await markThreadMissing(botContext(kit), { ticketId: ticket.id, threadId });
    expect(result).toEqual({ status: 'cleared', reprovisioned: true });
    const pending = (await jobsOfType(kit, OPEN_THREAD_JOB)).filter((j) => j.status === 'pending');
    expect(pending).toHaveLength(1);
  });

  it('priority change recomputes the SLA from the opening time and alerts on escalation', async () => {
    const member = await kit.member();
    const mod = await kit.member({ roles: ['moderator'] });
    const ops = await kit.member({ roles: ['operations'] });
    const ticket = await openAs(kit, member, { priority: 'low' });
    kit.clock.advance(HOUR);
    const raised = await setPriority(kit.as(mod), { ticketId: ticket.id, priority: 'urgent' });
    expect(raised.sla!.dueAt!.getTime()).toBe(ticket.createdAt.getTime() + 60 * MINUTE);
    expect(await auditOf(kit, 'ticket.priority_changed', ticket.id)).toHaveLength(1);
    const opsNotices = await notificationsFor(kit, ops.userId);
    expect(opsNotices.map((n) => n.title)).toEqual([
      `TICKET ${ticket.reference} — ESCALATED TO URGENT`,
    ]);
    // The escalating handler is not alerted about their own action.
    expect(await notificationsFor(kit, mod.userId)).toHaveLength(0);
  });

  it('BREAK: concurrent opens by the same user cannot exceed the limit', async () => {
    const member = await kit.member();
    await updateSettings(kit.system, 'tickets', { maxOpenPerUser: 1 });
    const attempts = await Promise.allSettled([
      openTicket(kit.as(member), {
        category: 'general',
        subject: 'First one',
        body: 'Hello there',
      }),
      openTicket(kit.as(member), {
        category: 'general',
        subject: 'Second one',
        body: 'Hello again',
      }),
    ]);
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find((a) => a.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
  });
});
