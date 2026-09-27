import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { AIRateLimitError, DisabledProvider, MockProvider, type MockResponder } from '@jave/ai';
import { aiRequests, tickets } from '@jave/database';
import {
  DisabledError,
  ExternalServiceError,
  ForbiddenError,
  RateLimitedError,
} from '../kernel/errors';
import type { UserActor } from '../permissions/actor';
import { updateSettings } from '../settings/settings.service';
import type { TestKit } from '../testing';
import { AI_SUMMARY_LABEL } from '../tickets/constants';
import { summarizeTicket, type TicketSummaryInput } from '../tickets/summary.service';
import {
  createTicketKit,
  INTEGRATION_HOOK_TIMEOUT,
  INTEGRATION_SUITE,
  openAs,
} from '../tickets/test-fixtures';
import { ask } from './features.service';
import { FINGERPRINT_DISPLAY_LENGTH, getUsageByUser, listAiRequests } from './requests.service';
import { ticketSummarizer, ticketTranscript } from './ticket-summary';

const STEP_MS = 1000;

describe('AI surfaces: ticket summaries and the request ledger', INTEGRATION_SUITE, () => {
  let kit: TestKit;
  let mock: MockProvider;
  let reply: MockResponder | undefined;
  const deps = () => ({ provider: mock });

  beforeEach(async () => {
    kit = await createTicketKit();
    reply = undefined;
    mock = new MockProvider({
      respond: (req, opts) =>
        reply ? reply(req, opts) : '- Build fails with OOM.\n- Next: raise memory.',
    });
  }, INTEGRATION_HOOK_TIMEOUT);
  afterEach(async () => {
    await kit.close();
  }, INTEGRATION_HOOK_TIMEOUT);

  describe('ticket summarizer', () => {
    it('summarizes through the guarded AI path with role labels only', async () => {
      const member = await kit.member({ roles: ['member'], username: 'requester_zed' });
      const mod = await kit.member({ roles: ['moderator'] });
      const ticket = await openAs(kit, member, {
        body: 'My token is ghp_abcdefghijklmnopqrstuvwxyz0123456789 and the build fails.',
      });
      const ctx = kit.as(mod);
      const summary = await summarizeTicket(ctx, ticket.id, ticketSummarizer(ctx, deps()));
      expect(summary).toMatchObject({ label: AI_SUMMARY_LABEL, cached: false });
      expect(summary.text).toContain('Build fails with OOM');

      const sent = mock.calls[0]!;
      expect(sent.context).toMatchObject({ feature: 'ticket_summary', userId: mod.userId });
      const content = sent.request.messages[0]!.content;
      expect(content).toContain('BEGIN UNTRUSTED DATA');
      expect(content).toContain('REQUESTER:');
      expect(content).not.toContain('requester_zed');
      expect(content).not.toContain(member.discordId);
      expect(content).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
      const [row] = await kit.db.select().from(aiRequests);
      expect(row).toMatchObject({ feature: 'ticket_summary', status: 'ok', userId: mod.userId });
    });

    it('fits the whole transcript into maxInputChars, oldest messages first to go', () => {
      const input: TicketSummaryInput = {
        instructions: 'x',
        ticket: {
          reference: '#0042',
          subject: 'Subject',
          category: 'technical',
          priority: 'normal',
          status: 'open',
        },
        messages: [
          { role: 'REQUESTER', at: '2026-03-01T12:00:00.000Z', text: 'a'.repeat(300) },
          { role: 'STAFF', at: '2026-03-01T12:01:00.000Z', text: 'b'.repeat(300) },
          { role: 'REQUESTER', at: '2026-03-01T12:02:00.000Z', text: 'newest' },
        ],
        truncated: false,
      };
      const max = 600;
      const transcript = ticketTranscript(input, max);
      expect(transcript.length).toBeLessThanOrEqual(max);
      expect(transcript).toContain('newest');
      expect(transcript).toContain('b'.repeat(300));
      expect(transcript).not.toContain('a'.repeat(300));
      expect(transcript).toContain('older messages were omitted');
      const tiny = ticketTranscript(
        { ...input, messages: [{ role: 'STAFF', at: 'now', text: 'z'.repeat(5000) }] },
        max,
      );
      expect(tiny.length).toBeLessThanOrEqual(max);
      expect(tiny).toContain('STAFF: zzz');
    });

    it('BREAK: a member without a handler role cannot spend AI on someone else’s ticket', async () => {
      const member = await kit.member({ roles: ['member'] });
      const other = await kit.member({ roles: ['verified'] });
      const ticket = await openAs(kit, member);
      const ctx = kit.as(other);
      await expect(
        summarizeTicket(ctx, ticket.id, ticketSummarizer(ctx, deps())),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(mock.calls).toHaveLength(0);
    });

    it('BREAK: AI disabled or provider failure never stores a summary', async () => {
      const member = await kit.member({ roles: ['member'] });
      const mod = await kit.member({ roles: ['moderator'] });
      const ticket = await openAs(kit, member);
      const ctx = kit.as(mod);
      reply = () => {
        throw new AIRateLimitError({ provider: 'mock' });
      };
      await expect(
        summarizeTicket(ctx, ticket.id, ticketSummarizer(ctx, deps())),
      ).rejects.toBeInstanceOf(ExternalServiceError);
      const [stored] = await kit.db.select().from(tickets).where(eq(tickets.id, ticket.id));
      expect(stored!.aiSummary).toBeNull();
    });

    it('surfaces the AI module’s own refusals (disabled provider, daily limit) unchanged', async () => {
      const member = await kit.member({ roles: ['member'] });
      const mod = await kit.member({ roles: ['moderator'] });
      const ticket = await openAs(kit, member);
      const ctx = kit.as(mod);
      await expect(
        summarizeTicket(
          ctx,
          ticket.id,
          ticketSummarizer(ctx, { provider: new DisabledProvider() }),
        ),
      ).rejects.toBeInstanceOf(DisabledError);
      await updateSettings(kit.system, 'ai', { dailyRequestsPerUser: 1 });
      await ask(ctx, deps(), { question: 'Spend the only request.' });
      await expect(
        summarizeTicket(ctx, ticket.id, ticketSummarizer(ctx, deps())),
      ).rejects.toBeInstanceOf(RateLimitedError);
    });
  });

  describe('request ledger views', () => {
    let a: UserActor;
    let b: UserActor;
    beforeEach(async () => {
      a = await kit.member({ roles: ['verified'], username: 'alpha' });
      b = await kit.member({ roles: ['verified'], username: 'bravo' });
      await ask(kit.as(a), deps(), { question: 'One?' });
      kit.clock.advance(STEP_MS);
      await ask(kit.as(a), deps(), { question: 'Two?' });
      kit.clock.advance(STEP_MS);
      await ask(kit.as(b), deps(), { question: 'Three?' });
    });

    it('lists only your own requests, without identity or fingerprint', async () => {
      const mine = await listAiRequests(kit.as(a));
      expect(mine.total).toBe(2);
      expect(mine.items.every((item) => item.requester === null && item.fingerprint === null)).toBe(
        true,
      );
      expect(JSON.stringify(mine)).not.toContain('One?');
    });

    it('auditors see everyone, with requester and a short fingerprint; never the prompt', async () => {
      const core = await kit.member({ roles: ['core'] });
      const all = await listAiRequests(kit.as(core), { scope: 'all' });
      expect(all.total).toBe(3);
      expect(all.items[0]!.requester).toMatchObject({ displayName: 'bravo' });
      expect(all.items[0]!.fingerprint).toHaveLength(FINGERPRINT_DISPLAY_LENGTH);
      expect(JSON.stringify(all)).not.toContain('Three?');
      const usage = await getUsageByUser(kit.as(core));
      expect(usage.map((u) => [u.displayName, u.counted])).toEqual([
        ['alpha', 2],
        ['bravo', 1],
      ]);
    });

    it('BREAK: operations staff and members cannot read everyone’s ledger', async () => {
      const ops = await kit.member({ roles: ['operations'] });
      await expect(listAiRequests(kit.as(ops), { scope: 'all' })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(getUsageByUser(kit.as(a))).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('per-member usage ties read in a stable order: by name, then id', async () => {
      const charlie = await kit.member({ roles: ['verified'], username: 'charlie' });
      await ask(kit.as(charlie), deps(), { question: 'Four?' });
      const core = await kit.member({ roles: ['core'] });
      const usage = await getUsageByUser(kit.as(core));
      expect(usage.map((u) => u.displayName)).toEqual(['alpha', 'bravo', 'charlie']);
    });

    it('counts per user follow the daily-limit rule', async () => {
      await updateSettings(kit.system, 'ai', { dailyRequestsPerUser: 2 });
      await expect(ask(kit.as(a), deps(), { question: 'Over?' })).rejects.toThrow();
      const core = await kit.member({ roles: ['core'] });
      const alpha = (await getUsageByUser(kit.as(core))).find((u) => u.userId === a.userId)!;
      expect(alpha).toMatchObject({ counted: 2, attempts: 3 });
    });
  });
});
