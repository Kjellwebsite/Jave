import { afterEach, describe, expect, it } from 'vitest';
import { DisabledProvider } from '@jave/ai';
import { DisabledError, tickets, updateSettings } from '@jave/core';
import type { BotHarness } from '../../testing/harness';
import { createBotHarness } from '../../testing/harness';
import { createAiHarness, HARNESS_TIMEOUT_MS, SUITE, type AiHarness } from './test-fixtures';
import { discordTicketSummarizer } from './ticket-summary';

const TICKET_CHANNEL_ID = '100000000000000601';
const ARCHIVE_CHANNEL_ID = '100000000000000602';

/** A requester's open ticket and a moderator who handles tickets. */
async function openTicketFor(bot: BotHarness) {
  await updateSettings(bot.kit.system, 'channels', {
    tickets: TICKET_CHANNEL_ID,
    ticketArchive: ARCHIVE_CHANNEL_ID,
  });
  const requester = await bot.member({ roles: ['member'], username: 'requester_zed' });
  const moderator = await bot.member({ roles: ['moderator'] });
  const ticket = await tickets.openTicket(bot.kit.as(requester.actor), {
    category: 'technical',
    subject: 'Deploy pipeline fails on build step',
    body: 'The build step exits with code 137 since yesterday.',
  });
  return { ticket, requester, moderator };
}

describe('ai wiring: ticket summaries through BotServices.ai', SUITE, () => {
  let t: AiHarness | null = null;
  let disabled: BotHarness | null = null;
  afterEach(async () => {
    await t?.bot.close();
    await disabled?.close();
    t = null;
    disabled = null;
  }, HARNESS_TIMEOUT_MS);

  it(
    'summarizes a ticket with the configured provider, as the handling moderator',
    async () => {
      t = await createAiHarness();
      t.script('- Build exits with 137 (out of memory).\n- Next: raise the runner memory.');
      const { ticket, requester, moderator } = await openTicketFor(t.bot);
      const ctx = t.bot.kit.as(moderator.actor);
      const summary = await tickets.summarizeTicket(
        ctx,
        ticket.id,
        discordTicketSummarizer({ ctx, services: t.bot.app.services }),
      );
      expect(summary).toMatchObject({ cached: false, label: tickets.AI_SUMMARY_LABEL });
      expect(summary.text).toContain('raise the runner memory');
      const sent = t.mock.calls[0]!;
      expect(sent.context).toMatchObject({
        feature: 'ticket_summary',
        surface: 'discord',
        userId: moderator.actor.userId,
      });
      expect(sent.request.messages[0]!.content).not.toContain('requester_zed');
      expect(sent.request.messages[0]!.content).not.toContain(requester.actor.discordId);
    },
    HARNESS_TIMEOUT_MS,
  );

  it(
    'BREAK: with AI_PROVIDER=disabled the summary is refused calmly and nothing is stored',
    async () => {
      disabled = await createBotHarness({ ai: { provider: new DisabledProvider() } });
      const { ticket, moderator } = await openTicketFor(disabled);
      const ctx = disabled.kit.as(moderator.actor);
      await expect(
        tickets.summarizeTicket(
          ctx,
          ticket.id,
          discordTicketSummarizer({ ctx, services: disabled.app.services }),
        ),
      ).rejects.toBeInstanceOf(DisabledError);
      const view = await tickets.getTicket(ctx, { ticketId: ticket.id });
      expect(view.aiSummary).toBeNull();
    },
    HARNESS_TIMEOUT_MS,
  );
});
