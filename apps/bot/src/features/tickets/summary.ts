import { DISABLED_PROVIDER_NAME, sanitizeForDiscord } from '@jave/ai';
import { ai, tickets } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { HandlerContext } from '../../interactions/types';
import { button, panel, row } from '../../ui/components';
import { COLORS, GLYPH } from '../../ui/theme';
import { ACTION, SUMMARY_DISPLAY_MAX, TICKETS_NS } from './constants';
import { requireHandling } from './resolve';

const FORCE_ARG = 'force';

/** An AI provider is wired in and not the explicit `disabled` provider. */
export function aiAvailable(deps: ai.AiDeps | undefined): deps is ai.AiDeps {
  return deps !== undefined && deps.provider.name !== DISABLED_PROVIDER_NAME;
}

function disabledPanel(reference: string) {
  return {
    embeds: [
      panel({
        kicker: tickets.AI_SUMMARY_LABEL,
        title: `Summary ${reference} ${GLYPH.dot} DISABLED`,
        description:
          'JAVE AI is not configured on this deployment. Summaries appear here once an AI provider is set up.',
        color: COLORS.steel,
      }),
    ],
    ephemeral: true,
  };
}

/** /ticket summary and its REGENERATE button. Staff only; always labelled AI-GENERATED. */
export async function showSummary(
  h: HandlerContext,
  ticketId: string,
  force: boolean,
): Promise<void> {
  requireHandling(h);
  const card = await tickets.getTicketCard(h.ctx, { ticketId });
  const deps = h.services.ai;
  if (!aiAvailable(deps)) {
    await h.respond(disabledPanel(card.reference));
    return;
  }
  if (!h.interaction.deferred && !h.interaction.replied) {
    await h.interaction.defer({ ephemeral: true });
  }
  const summary = await tickets.summarizeTicket(
    h.ctx,
    ticketId,
    ai.ticketSummarizer(h.ctx, deps, 'discord'),
    { force },
  );
  const origin = summary.cached ? 'Stored summary, no messages since' : 'Generated';
  await h.respond({
    embeds: [
      panel({
        kicker: `${summary.label} ${GLYPH.dot} STAFF ONLY`,
        title: `Summary ${card.reference}`,
        description: sanitizeForDiscord(summary.text, SUMMARY_DISPLAY_MAX),
        color: COLORS.info,
        footer: `${origin}. Machine-written and unverified — check the thread before acting.`,
        timestamp: summary.generatedAt,
      }),
    ],
    components: [
      row(button('Regenerate', customId(TICKETS_NS, ACTION.summary, ticketId, FORCE_ARG))),
    ],
    ephemeral: true,
  });
}

export function isForced(args: readonly string[]): boolean {
  return args[1] === FORCE_ARG;
}
