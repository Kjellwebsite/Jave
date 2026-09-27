import { Sparkles } from 'lucide-react';
import type { tickets } from '@jave/core';
import { Badge, Mono } from '@jave/ui';
import { formatTimestamp } from '@/lib/time';
import type { FormAction } from '../forms/action-form';
import { InstantAction } from './ticket-controls';

export interface AiSummaryPanelProps {
  ticketId: string;
  summary: tickets.TicketAiSummary | null;
  /** An AI provider is configured on this deployment. */
  available: boolean;
  /** The viewer may generate one now (handler, ticket not archived). */
  canGenerate: boolean;
  action: FormAction;
  timeZone: string;
}

/**
 * The AI summary extension point, staff only. A stored summary always carries
 * the AI-GENERATED label; without a configured provider the panel says
 * DISABLED instead of pretending.
 */
export function AiSummaryPanel({
  ticketId,
  summary,
  available,
  canGenerate,
  action,
  timeZone,
}: AiSummaryPanelProps) {
  return (
    <div className="space-y-4" data-testid="ai-summary">
      {summary ? (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">{summary.label}</Badge>
            <Mono dim className="text-[12px]">
              {formatTimestamp(summary.generatedAt, timeZone)}
            </Mono>
          </div>
          <p className="whitespace-pre-wrap break-words text-small text-fg-muted">{summary.text}</p>
          <p className="text-[12px] text-fg-subtle">
            Machine-written and unverified. Check the conversation before acting.
          </p>
        </div>
      ) : null}
      {!available ? (
        <p className="text-small text-fg-subtle">
          <span className="type-eyebrow mr-2 text-fg-muted">DISABLED</span>
          No AI provider is configured on this deployment.
        </p>
      ) : canGenerate ? (
        <>
          {summary ? null : (
            <p className="text-small text-fg-subtle">
              A short brief of the conversation for the next handler. Internal notes are included;
              names are not sent.
            </p>
          )}
          <InstantAction
            action={action}
            hidden={{ ticketId }}
            label={summary ? 'Refresh summary' : 'Generate summary'}
            icon={Sparkles}
            size="sm"
            testId="generate-summary"
          />
        </>
      ) : summary ? null : (
        <p className="text-small text-fg-subtle">No summary was generated for this ticket.</p>
      )}
    </div>
  );
}
