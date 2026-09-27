import type { AISurface } from '@jave/ai';
import type { ServiceContext } from '../kernel/context';
import { truncate } from '../kernel/redact';
import { getSettings } from '../settings/settings.service';
import type { TicketSummarizer, TicketSummaryInput } from '../tickets/summary.service';
import { type AiDeps, runCompletion } from './runtime';

const TRANSCRIPT_LABEL = 'support_ticket';
const OMITTED_NOTE = 'Note: older messages were omitted to fit the input budget.';
/** Newlines joining the header, the omission note and the blank separator line. */
const HEADER_SEPARATORS = 3;

/**
 * The ticket as one untrusted transcript: a short header, then messages
 * oldest first, each prefixed with its time and role label (never a name).
 * Messages are dropped oldest-first so the whole transcript fits `maxChars`;
 * the tickets module packed the bodies into the AI budget, but the header
 * and prefixes add to it.
 */
export function ticketTranscript(input: TicketSummaryInput, maxChars: number): string {
  const { ticket } = input;
  const header = [
    `TICKET ${ticket.reference}`,
    `Subject: ${ticket.subject}`,
    `Category: ${ticket.category} · Priority: ${ticket.priority} · Status: ${ticket.status}`,
  ].join('\n');
  const lines = input.messages.map((m) => `[${m.at}] ${m.role}: ${m.text}`);
  const kept: string[] = [];
  let omitted = input.truncated;
  let budget = maxChars - header.length - OMITTED_NOTE.length - HEADER_SEPARATORS;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (line.length + 1 > budget) {
      omitted = true;
      // Never send a header alone: keep the start of the newest message.
      if (kept.length === 0 && budget > 1) kept.unshift(truncate(line, budget - 1));
      break;
    }
    budget -= line.length + 1;
    kept.unshift(line);
  }
  return [header, ...(omitted ? [OMITTED_NOTE] : []), '', ...kept].join('\n');
}

/**
 * The tickets AI summary extension point, wired to the AI module. Every
 * summary takes the guarded completion path as the staff member who asked
 * (canUseAI, burst and daily limits, settings.ai.enabled, input cap, secret
 * redaction, untrusted-data wrapping, prompt-free ledger). The ticket's own
 * instructions travel as the trusted request; everything users wrote travels
 * as untrusted data. Usage:
 * `tickets.summarizeTicket(ctx, id, ai.ticketSummarizer(ctx, deps, 'dashboard'))`.
 */
export function ticketSummarizer(
  ctx: ServiceContext,
  deps: AiDeps,
  surface: AISurface = 'discord',
): TicketSummarizer {
  return async (input) => {
    const { maxInputChars } = await getSettings(ctx, 'ai');
    const request = input.instructions;
    const result = await runCompletion(ctx, deps, {
      feature: 'summarize',
      surface,
      request,
      data: [
        {
          label: TRANSCRIPT_LABEL,
          text: ticketTranscript(input, Math.max(0, maxInputChars - request.length)),
        },
      ],
    });
    return result.text;
  };
}
