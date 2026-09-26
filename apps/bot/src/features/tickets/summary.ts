import { DISABLED_PROVIDER_NAME, sanitizeForDiscord } from '@jave/ai';
import { ai, getSettings, type ServiceContext, tickets, truncate } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { HandlerContext } from '../../interactions/types';
import { button, panel, row } from '../../ui/components';
import { COLORS, GLYPH } from '../../ui/theme';
import { ACTION, SUMMARY_DISPLAY_MAX, TICKETS_NS } from './constants';
import { requireHandling } from './resolve';

/** Marker placed where older messages were dropped to fit the AI input budget. */
export const OMITTED_MARKER = '[earlier messages omitted]';
/** The trusted request may use at most this share of the input budget. */
const REQUEST_SHARE = 0.5;
const FORCE_ARG = 'force';

export interface SummaryRequest {
  /** Trusted: JAVE's own instructions plus enum metadata. */
  question: string;
  /** Untrusted: the subject and transcript, wrapped as data by core AI. */
  context: string;
}

/**
 * Pure. Turns core's summary input into one JAVE AI request that fits
 * `maxChars` (question + context, the limit core AI enforces): the ticket's
 * own instructions travel as the request; everything users wrote travels as
 * untrusted context, newest messages kept first.
 */
export function summaryRequest(
  input: tickets.TicketSummaryInput,
  maxChars: number,
): SummaryRequest {
  const { reference, category, priority, status, subject } = input.ticket;
  const question = truncate(
    `${input.instructions}\nTicket ${reference} ${GLYPH.dot} category ${category} ${GLYPH.dot} priority ${priority} ${GLYPH.dot} status ${status}.`,
    Math.floor(maxChars * REQUEST_SHARE),
  );
  const header = `Subject: ${subject}`;
  const lines = input.messages.map((m) => `[${m.at}] ${m.role}: ${m.text}`);
  // Newlines after the header and the omission marker.
  const separators = 2;
  const budget = Math.max(
    0,
    maxChars - question.length - header.length - OMITTED_MARKER.length - separators,
  );
  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    const cost = line.length + 1;
    if (used + cost > budget) {
      if (kept.length === 0 && budget > 1) kept.unshift(truncate(line, budget - 1));
      break;
    }
    kept.unshift(line);
    used += cost;
  }
  const omitted = input.truncated || kept.length < lines.length;
  const context = [header, ...(omitted ? [OMITTED_MARKER] : []), ...kept].join('\n');
  return { question, context };
}

/** An AI provider is wired in and not the explicit `disabled` provider. */
export function aiAvailable(deps: ai.AiDeps | undefined): deps is ai.AiDeps {
  return deps !== undefined && deps.provider.name !== DISABLED_PROVIDER_NAME;
}

/**
 * The TicketSummarizer extension point, backed by JAVE AI: the request goes
 * through core AI's guards (canUseAI, burst and daily limits, redaction,
 * untrusted-data wrapping, ledger) as the staff member who asked. Same shape
 * as wave2/ai-research's `ai.ticketSummarizer(ctx, deps, surface)`.
 */
export function ticketSummarizer(
  ctx: ServiceContext,
  deps: ai.AiDeps,
  surface: 'discord' | 'dashboard',
): tickets.TicketSummarizer {
  return async (input) => {
    const { maxInputChars } = await getSettings(ctx, 'ai');
    const answer = await ai.ask(ctx, deps, { ...summaryRequest(input, maxInputChars), surface });
    return answer.text;
  };
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
    ticketSummarizer(h.ctx, deps, 'discord'),
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
