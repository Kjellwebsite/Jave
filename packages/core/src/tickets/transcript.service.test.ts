import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import pino from 'pino';
import { ticketEvents } from '@jave/database';
import { MINUTE } from '../kernel/clock';
import {
  DisabledError,
  ExternalServiceError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../kernel/errors';
import { updateSettings } from '../settings/settings.service';
import type { TestKit } from '../testing';
import { AI_SUMMARY_LABEL } from './constants';
import { closeTicket } from './lifecycle.service';
import { addInternalNote, recordMessage } from './messages.service';
import { getTicket } from './queries.service';
import { summarizeTicket, type TicketSummaryInput } from './summary.service';
import {
  auditOf,
  authorOf,
  botContext,
  createTicketKit,
  INTEGRATION_SUITE,
  nextSnowflake,
  openAs,
  provisionThread,
} from './test-fixtures';
import { renderTranscript } from './transcript.service';

const HOSTILE = '<script>alert("xss")</script><img src=x onerror=alert(1)>';

/** TEST-ONLY stub summarizer: records its input, returns canned text. Never used in production. */
function stubSummarizer(text = '- Build fails with OOM.\n- Next: raise memory limit.') {
  const calls: TicketSummaryInput[] = [];
  const summarizer = async (input: TicketSummaryInput) => {
    calls.push(input);
    return text;
  };
  return { calls, summarizer };
}

describe('tickets: transcripts and AI summary', INTEGRATION_SUITE, () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTicketKit();
  });
  afterEach(async () => {
    await kit.close();
  });

  async function hostileTicket() {
    const member = await kit.member({ username: 'requester_1' });
    const mod = await kit.member({ roles: ['moderator'] });
    const ops = await kit.member({ roles: ['operations'] });
    const ticket = await openAs(kit, member, {
      subject: `Help ${HOSTILE}`,
      body: `Body ${HOSTILE}`,
    });
    const threadId = await provisionThread(kit, ticket.id);
    await recordMessage(botContext(kit), {
      threadId,
      discordMessageId: nextSnowflake(),
      author: authorOf(member),
      body: `Reply ${HOSTILE}`,
      attachments: [{ name: `evil${HOSTILE}.png`, url: 'https://cdn.example/x.png', size: 99 }],
    });
    await addInternalNote(kit.as(mod), {
      ticketId: ticket.id,
      body: 'STAFF-ONLY: requester flagged in a prior report.',
    });
    return { member, mod, ops, ticket };
  }

  it('opener gets an escaped transcript without internal notes; access is audited', async () => {
    const { member, ticket } = await hostileTicket();
    const html = await renderTranscript(kit.as(member), { ticketId: ticket.id, format: 'html' });
    expect(html.includesInternal).toBe(false);
    expect(html.filename).toMatch(/^ticket-\d{4}\.html$/);
    expect(html.contentType).toBe('text/html; charset=utf-8');
    expect(html.content).not.toContain('<script>');
    expect(html.content).not.toContain('<img');
    expect(html.content).toContain('&lt;script&gt;');
    expect(html.content).not.toContain('STAFF-ONLY');
    expect(html.content).not.toContain('INTERNAL NOTE');

    const md = await renderTranscript(kit.as(member), { ticketId: ticket.id, format: 'markdown' });
    expect(md.filename).toMatch(/\.md$/);
    expect(md.content).not.toContain('STAFF-ONLY');
    expect(md.content).toContain('\\<script\\>');

    expect(await auditOf(kit, 'ticket.transcript_accessed', ticket.id)).toHaveLength(2);
    const events = await kit.db
      .select()
      .from(ticketEvents)
      .where(eq(ticketEvents.ticketId, ticket.id));
    expect(events.filter((e) => e.type === 'transcript_accessed')).toHaveLength(2);
    // The access event itself is staff-only: the requester's view does not list it.
    const view = await getTicket(kit.as(member), { ticketId: ticket.id });
    expect(view.events.some((e) => e.type === 'transcript_accessed')).toBe(false);
  });

  it('ticket managers get everything, including internal notes', async () => {
    const { ops, ticket } = await hostileTicket();
    const full = await renderTranscript(kit.as(ops), {
      ticketId: ticket.id,
      format: 'html',
      includeInternal: true,
    });
    expect(full.includesInternal).toBe(true);
    expect(full.filename).toMatch(/-internal\.html$/);
    expect(full.content).toContain('STAFF-ONLY');
    expect(full.content).toContain('INTERNAL NOTE');
    expect(full.content).not.toContain('<script>');
    const [audit] = await auditOf(kit, 'ticket.transcript_accessed', ticket.id);
    expect(audit!.context).toMatchObject({ includeInternal: true, format: 'html' });
    expect(audit!.actorUserId).toBe(ops.userId);
  });

  it('BREAK: opener cannot request internal notes in a transcript', async () => {
    const { member, ticket } = await hostileTicket();
    await expect(
      renderTranscript(kit.as(member), { ticketId: ticket.id, includeInternal: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const denied = await auditOf(kit, 'access.denied', ticket.id);
    expect(denied).toHaveLength(1);
    expect(denied[0]!.context).toMatchObject({ rule: 'requester_internal_transcript' });
    expect(await auditOf(kit, 'ticket.transcript_accessed', ticket.id)).toHaveLength(0);
  });

  it('BREAK: staff opener of their own ticket still gets no internal notes', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const colleague = await kit.member({ roles: ['operations'] });
    const ticket = await openAs(kit, ops);
    await addInternalNote(kit.as(colleague), { ticketId: ticket.id, body: 'About the opener.' });
    await expect(
      renderTranscript(kit.as(ops), { ticketId: ticket.id, includeInternal: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const own = await getTicket(kit.as(ops), { ticketId: ticket.id });
    expect(own.viewer).toBe('requester');
    expect(own.messages.some((m) => m.isInternal)).toBe(false);
  });

  it('BREAK: moderators (handle only) and other members cannot export transcripts', async () => {
    const { mod, ticket } = await hostileTicket();
    const outsider = await kit.member();
    await expect(renderTranscript(kit.as(mod), { ticketId: ticket.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      renderTranscript(kit.as(outsider), { ticketId: ticket.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await auditOf(kit, 'access.denied', ticket.id)).toHaveLength(2);
  });

  it('the bot (system) renders the archive transcript and it is audited as system', async () => {
    const { member, ticket } = await hostileTicket();
    await closeTicket(kit.as(member), { ticketId: ticket.id, reason: 'Solved.' });
    const archive = await renderTranscript(botContext(kit), {
      ticketId: ticket.id,
      format: 'html',
      includeInternal: false,
    });
    expect(archive.content).not.toContain('STAFF-ONLY');
    const [audit] = await auditOf(kit, 'ticket.transcript_accessed', ticket.id);
    expect(audit!.actorType).toBe('system');
  });

  it('summarizes with a stub, stores it labeled, and reuses it until the ticket changes', async () => {
    const { mod, member, ticket } = await hostileTicket();
    const stub = stubSummarizer();
    const first = await summarizeTicket(kit.as(mod), ticket.id, stub.summarizer);
    expect(first).toMatchObject({ label: AI_SUMMARY_LABEL, cached: false });
    expect(stub.calls).toHaveLength(1);
    const input = stub.calls[0]!;
    // Pseudonymous: no names or IDs reach the summarizer.
    expect(JSON.stringify(input)).not.toContain('requester_1');
    expect(JSON.stringify(input)).not.toContain(member.discordId);
    expect(input.messages.map((m) => m.role)).toEqual(['REQUESTER', 'REQUESTER', 'INTERNAL NOTE']);
    expect(input.instructions).toContain('untrusted');

    const again = await summarizeTicket(kit.as(mod), ticket.id, stub.summarizer);
    expect(again.cached).toBe(true);
    expect(stub.calls).toHaveLength(1);

    kit.clock.advance(MINUTE);
    await addInternalNote(kit.as(mod), { ticketId: ticket.id, body: 'New info.' });
    const fresh = await summarizeTicket(kit.as(mod), ticket.id, stub.summarizer);
    expect(fresh.cached).toBe(false);
    expect(stub.calls).toHaveLength(2);

    const forced = await summarizeTicket(kit.as(mod), ticket.id, stub.summarizer, {
      force: true,
    });
    expect(forced.cached).toBe(false);
    expect(stub.calls).toHaveLength(3);

    const staff = await getTicket(kit.as(mod), { ticketId: ticket.id });
    expect(staff.aiSummary).toMatchObject({ label: 'AI-GENERATED', text: first.text });
    const requester = await getTicket(kit.as(member), { ticketId: ticket.id });
    expect(requester.aiSummary).toBeNull();
    expect(await auditOf(kit, 'ticket.summary_generated', ticket.id)).toHaveLength(3);
  });

  it('a message recorded late with an old timestamp still invalidates the summary', async () => {
    const { member, mod, ticket } = await hostileTicket();
    const view = await getTicket(kit.as(mod), { ticketId: ticket.id });
    const stub = stubSummarizer();
    kit.clock.advance(10 * MINUTE);
    await summarizeTicket(kit.as(mod), ticket.id, stub.summarizer);
    await recordMessage(botContext(kit), {
      threadId: view.thread!.threadId,
      discordMessageId: nextSnowflake(),
      author: authorOf(member),
      body: 'Sent before the summary, delivered after it.',
      sentAt: new Date(kit.clock.now().getTime() - 5 * MINUTE),
    });
    const next = await summarizeTicket(kit.as(mod), ticket.id, stub.summarizer);
    expect(next.cached).toBe(false);
    expect(stub.calls).toHaveLength(2);
  });

  it('redacts secrets and respects the AI input budget', async () => {
    const member = await kit.member();
    const mod = await kit.member({ roles: ['moderator'] });
    await updateSettings(kit.system, 'ai', { maxInputChars: 200 });
    const ticket = await openAs(kit, member, {
      body: `My token is ghp_${'a'.repeat(40)} please help`,
    });
    const threadId = await provisionThread(kit, ticket.id);
    for (let i = 0; i < 5; i++) {
      kit.clock.advance(MINUTE);
      await recordMessage(botContext(kit), {
        threadId,
        discordMessageId: nextSnowflake(),
        author: authorOf(member),
        body: `Message ${i} ${'x'.repeat(60)}`,
      });
    }
    const stub = stubSummarizer();
    await summarizeTicket(kit.as(mod), ticket.id, stub.summarizer);
    const input = stub.calls[0]!;
    expect(input.truncated).toBe(true);
    expect(input.messages.reduce((n, m) => n + m.text.length, 0)).toBeLessThanOrEqual(200);
    expect(input.messages.at(-1)!.text).toContain('Message 4');
    expect(JSON.stringify(input)).not.toContain('ghp_');
  });

  it('handles summarizer failure and empty output without storing anything', async () => {
    const { mod, ticket } = await hostileTicket();
    const lines: string[] = [];
    const logger = pino({ level: 'info' }, { write: (line: string) => lines.push(line) });
    const secret = `sk-ant-${'k'.repeat(32)}`;
    await expect(
      summarizeTicket({ ...kit.as(mod), logger }, ticket.id, async () => {
        throw new Error(`provider down: key ${secret}`);
      }),
    ).rejects.toBeInstanceOf(ExternalServiceError);
    expect(lines.join('')).toContain('ticket summarizer failed');
    expect(lines.join('')).not.toContain(secret);
    await expect(
      summarizeTicket(kit.as(mod), ticket.id, async () => '   \u0000  '),
    ).rejects.toBeInstanceOf(ValidationError);
    const view = await getTicket(kit.as(mod), { ticketId: ticket.id });
    expect(view.aiSummary).toBeNull();
  });

  it('caps an oversized AI answer', async () => {
    const { mod, ticket } = await hostileTicket();
    const result = await summarizeTicket(kit.as(mod), ticket.id, async () => 'y'.repeat(50_000));
    expect(result.text.length).toBeLessThanOrEqual(2000);
  });

  it('BREAK: requester and non-handlers cannot summarize; AI can be switched off', async () => {
    const { member, mod, ticket } = await hostileTicket();
    const stub = stubSummarizer();
    await expect(
      summarizeTicket(kit.as(member), ticket.id, stub.summarizer),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      summarizeTicket(kit.as(mod), 'not-a-uuid', stub.summarizer),
    ).rejects.toBeInstanceOf(ValidationError);
    await updateSettings(kit.system, 'ai', { enabled: false });
    await expect(summarizeTicket(kit.as(mod), ticket.id, stub.summarizer)).rejects.toBeInstanceOf(
      DisabledError,
    );
    expect(stub.calls).toHaveLength(0);
  });
});
