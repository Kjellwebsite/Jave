import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ticketMessages, tickets, users } from '@jave/database';
import { MINUTE } from '../kernel/clock';
import { InvalidStateError, ValidationError } from '../kernel/errors';
import type { TestKit } from '../testing';
import { claimTicket, setWaiting } from './assignment.service';
import { UPDATE_CARD_JOB } from './discord-jobs';
import { closeTicket } from './lifecycle.service';
import {
  addInternalNote,
  recordMessage,
  recordMessageDelete,
  recordMessageEdit,
} from './messages.service';
import { getTicket } from './queries.service';
import {
  auditOf,
  authorOf,
  botContext,
  createTicketKit,
  INTEGRATION_SUITE,
  jobsOfType,
  nextSnowflake,
  openAs,
  provisionThread,
} from './test-fixtures';

describe('tickets: messages', INTEGRATION_SUITE, () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTicketKit();
  });
  afterEach(async () => {
    await kit.close();
  });

  async function ticketWithThread() {
    const member = await kit.member({ roles: ['verified'] });
    const mod = await kit.member({ roles: ['moderator'] });
    const ticket = await openAs(kit, member);
    const threadId = await provisionThread(kit, ticket.id);
    return { member, mod, ticket, threadId };
  }

  it('is idempotent on the Discord message id', async () => {
    const { member, ticket, threadId } = await ticketWithThread();
    const input = {
      threadId,
      discordMessageId: nextSnowflake(),
      author: authorOf(member),
      body: 'Additional context.',
    };
    const first = await recordMessage(botContext(kit), input);
    const second = await recordMessage(botContext(kit), input);
    expect(first.outcome.status).toBe('recorded');
    expect(second.outcome).toMatchObject({
      status: 'duplicate',
      ticketId: ticket.id,
    });
    if (first.outcome.status === 'recorded' && second.outcome.status === 'duplicate') {
      expect(second.outcome.messageId).toBe(first.outcome.messageId);
    }
    const rows = await kit.db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.ticketId, ticket.id));
    expect(rows).toHaveLength(2); // opening message + one thread message
  });

  it('BREAK: concurrent deliveries of the same message store it once', async () => {
    const { member, ticket, threadId } = await ticketWithThread();
    const input = {
      threadId,
      discordMessageId: nextSnowflake(),
      author: authorOf(member),
      body: 'Sent twice by a reconnecting gateway.',
    };
    const results = await Promise.all([
      recordMessage(botContext(kit), input),
      recordMessage(botContext(kit), input),
      recordMessage(botContext(kit), input),
    ]);
    expect(results.filter((r) => r.outcome.status === 'recorded')).toHaveLength(1);
    const rows = await kit.db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.ticketId, ticket.id));
    expect(rows).toHaveLength(2);
  });

  it('stamps firstResponseAt only for a handler who is not the opener', async () => {
    const { member, mod, ticket, threadId } = await ticketWithThread();
    kit.clock.advance(3 * MINUTE);
    const own = await recordMessage(botContext(kit), {
      threadId,
      discordMessageId: nextSnowflake(),
      author: authorOf(member),
      body: 'Any update?',
    });
    expect(own).toMatchObject({ authorRole: 'requester', firstResponse: false });

    kit.clock.advance(7 * MINUTE);
    const sentAt = new Date(kit.clock.now().getTime() - MINUTE);
    const staff = await recordMessage(botContext(kit), {
      threadId,
      discordMessageId: nextSnowflake(),
      author: authorOf(mod),
      body: 'Looking into it now.',
      sentAt,
    });
    expect(staff).toMatchObject({ authorRole: 'handler', firstResponse: true });
    const [row] = await kit.db.select().from(tickets).where(eq(tickets.id, ticket.id));
    expect(row!.firstResponseAt).toEqual(sentAt);
    expect(row!.lastActivityAt).toEqual(sentAt);

    const later = await recordMessage(botContext(kit), {
      threadId,
      discordMessageId: nextSnowflake(),
      author: authorOf(mod),
      body: 'Follow-up.',
    });
    expect(later.firstResponse).toBe(false);
  });

  it('staff opener replying in their own ticket is the requester, not a first response', async () => {
    const opener = await kit.member({ roles: ['moderator'] });
    const ticket = await openAs(kit, opener);
    const threadId = await provisionThread(kit, ticket.id);
    const result = await recordMessage(botContext(kit), {
      threadId,
      discordMessageId: nextSnowflake(),
      author: authorOf(opener),
      body: 'Adding details to my own ticket.',
    });
    expect(result).toMatchObject({ authorRole: 'requester', firstResponse: false });
  });

  it('resolves unknown Discord authors as participants and creates their user row', async () => {
    const { threadId } = await ticketWithThread();
    const stranger = { discordId: '555555555555555555', username: 'guest_user' };
    const result = await recordMessage(botContext(kit), {
      threadId,
      discordMessageId: nextSnowflake(),
      author: stranger,
      body: 'Hi, I was added to help.',
    });
    expect(result.authorRole).toBe('participant');
    const [user] = await kit.db.select().from(users).where(eq(users.discordId, stranger.discordId));
    expect(user?.username).toBe('guest_user');
  });

  it('ignores bot authors, unknown threads and archived tickets', async () => {
    const { member, threadId } = await ticketWithThread();
    const base = { discordMessageId: nextSnowflake(), body: 'x' };
    await expect(
      recordMessage(botContext(kit), {
        ...base,
        threadId: nextSnowflake(),
        author: authorOf(member),
      }),
    ).resolves.toMatchObject({ outcome: { status: 'ignored', reason: 'not_a_ticket' } });
    await expect(
      recordMessage(botContext(kit), {
        ...base,
        threadId,
        author: { ...authorOf(member), bot: true },
      }),
    ).resolves.toMatchObject({ outcome: { status: 'ignored', reason: 'bot_author' } });
  });

  it('stores attachment metadata only and accepts attachment-only messages', async () => {
    const { member, ticket, threadId } = await ticketWithThread();
    await recordMessage(botContext(kit), {
      threadId,
      discordMessageId: nextSnowflake(),
      author: authorOf(member),
      body: '',
      attachments: [
        {
          name: 'build.log',
          url: 'https://cdn.discordapp.com/attachments/1/2/build.log',
          size: 20480,
          contentType: 'text/plain',
        },
      ],
    });
    const view = await getTicket(kit.as(member), { ticketId: ticket.id });
    expect(view.messages.at(-1)!.attachments).toEqual([
      {
        name: 'build.log',
        url: 'https://cdn.discordapp.com/attachments/1/2/build.log',
        size: 20480,
        contentType: 'text/plain',
      },
    ]);
    await expect(
      recordMessage(botContext(kit), {
        threadId,
        discordMessageId: nextSnowflake(),
        author: authorOf(member),
        body: '   ',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('BREAK: rejects non-http attachment URLs', async () => {
    const { member, threadId } = await ticketWithThread();
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'ftp://x/y']) {
      await expect(
        recordMessage(botContext(kit), {
          threadId,
          discordMessageId: nextSnowflake(),
          author: authorOf(member),
          body: 'look',
          attachments: [{ name: 'a', url, size: 1 }],
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it('requester reply resumes a waiting ticket and refreshes the card', async () => {
    const { member, mod, ticket, threadId } = await ticketWithThread();
    await claimTicket(kit.as(mod), { ticketId: ticket.id });
    await setWaiting(kit.as(mod), { ticketId: ticket.id, reason: 'Need the repo URL.' });
    const result = await recordMessage(botContext(kit), {
      threadId,
      discordMessageId: nextSnowflake(),
      author: authorOf(member),
      body: 'https://github.com/example/repo',
    });
    expect(result.resumed).toBe(true);
    const view = await getTicket(kit.as(mod), { ticketId: ticket.id });
    expect(view.status).toBe('claimed');
    const changes = (await jobsOfType(kit, UPDATE_CARD_JOB)).map(
      (j) => (j.payload as { change: string }).change,
    );
    expect(changes).toEqual(['refresh', 'claimed', 'waiting', 'resumed']);
  });

  it('clamps Discord timestamps into [opened, now]', async () => {
    const { member, ticket, threadId } = await ticketWithThread();
    await recordMessage(botContext(kit), {
      threadId,
      discordMessageId: nextSnowflake(),
      author: authorOf(member),
      body: 'From the future',
      sentAt: new Date('2099-01-01T00:00:00Z'),
    });
    await recordMessage(botContext(kit), {
      threadId,
      discordMessageId: nextSnowflake(),
      author: authorOf(member),
      body: 'From the past',
      sentAt: new Date('2001-01-01T00:00:00Z'),
    });
    const rows = await kit.db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.ticketId, ticket.id));
    for (const row of rows) {
      expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(ticket.createdAt.getTime());
      expect(row.createdAt.getTime()).toBeLessThanOrEqual(kit.clock.now().getTime());
    }
  });

  it('records edits (keeping the original) and deletions', async () => {
    const { member, mod, ticket, threadId } = await ticketWithThread();
    const discordMessageId = nextSnowflake();
    await recordMessage(botContext(kit), {
      threadId,
      discordMessageId,
      author: authorOf(member),
      body: 'my password is hunter2',
    });
    await expect(
      recordMessageEdit(botContext(kit), { discordMessageId, body: 'my password is [removed]' }),
    ).resolves.toMatchObject({ status: 'recorded' });
    await expect(
      recordMessageEdit(botContext(kit), { discordMessageId, body: 'my password is [removed]' }),
    ).resolves.toEqual({ status: 'ignored', reason: 'unchanged' });
    await recordMessageEdit(botContext(kit), { discordMessageId, body: 'second edit' });

    const staffView = await getTicket(kit.as(mod), { ticketId: ticket.id });
    const edited = staffView.messages.find((m) => m.body === 'second edit');
    expect(edited?.originalBody).toBe('my password is hunter2');
    expect(edited?.editedAt).not.toBeNull();
    const requesterView = await getTicket(kit.as(member), { ticketId: ticket.id });
    expect(requesterView.messages.find((m) => m.body === 'second edit')?.originalBody).toBeNull();

    await recordMessageDelete(botContext(kit), { discordMessageId });
    await expect(recordMessageDelete(botContext(kit), { discordMessageId })).resolves.toEqual({
      status: 'ignored',
      reason: 'deleted',
    });
    const afterDelete = await getTicket(kit.as(member), { ticketId: ticket.id });
    expect(afterDelete.messages.some((m) => m.body === 'second edit')).toBe(false);
    const staffAfter = await getTicket(kit.as(mod), { ticketId: ticket.id });
    expect(staffAfter.messages.find((m) => m.body === 'second edit')?.deletedAt).not.toBeNull();
    await expect(
      recordMessageEdit(botContext(kit), { discordMessageId: nextSnowflake(), body: 'x' }),
    ).resolves.toEqual({ status: 'ignored', reason: 'unknown_message' });
  });

  it('internal notes are audited, staff-only, and leave lastActivityAt alone', async () => {
    const { member, mod, ticket } = await ticketWithThread();
    const before = (await getTicket(kit.as(mod), { ticketId: ticket.id })).lastActivityAt;
    kit.clock.advance(MINUTE);
    const { messageId } = await addInternalNote(kit.as(mod), {
      ticketId: ticket.id,
      body: 'Requester had a similar issue last month (#0003).',
    });
    expect(await auditOf(kit, 'ticket.internal_note_added', ticket.id)).toHaveLength(1);
    const staffView = await getTicket(kit.as(mod), { ticketId: ticket.id });
    expect(staffView.messages.find((m) => m.id === messageId)?.isInternal).toBe(true);
    expect(staffView.lastActivityAt).toEqual(before);
    const requesterView = await getTicket(kit.as(member), { ticketId: ticket.id });
    expect(requesterView.messages.some((m) => m.id === messageId)).toBe(false);
  });

  it('internal notes are allowed on closed tickets but not archived ones', async () => {
    const { member, mod, ticket } = await ticketWithThread();
    await closeTicket(kit.as(member), { ticketId: ticket.id, reason: 'Resolved.' });
    await addInternalNote(kit.as(mod), { ticketId: ticket.id, body: 'Post-mortem: config.' });
    await kit.db.update(tickets).set({ status: 'archived' }).where(eq(tickets.id, ticket.id));
    await expect(
      addInternalNote(kit.as(mod), { ticketId: ticket.id, body: 'Too late.' }),
    ).rejects.toBeInstanceOf(InvalidStateError);
  });
});
