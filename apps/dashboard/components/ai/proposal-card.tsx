import { Mono, StatusBadge } from '@jave/ui';
import type { FormAction } from '@/components/forms/action-form';
import {
  kindLabel,
  PROPOSAL_STATUS_LABELS,
  PROPOSAL_STATUS_TONE,
  type ProposalStatus,
} from '@/lib/ai-labels';
import { ProposalActions } from './proposal-actions';

/** Serializable proposal as the card renders it (times pre-formatted in the viewer's zone). */
export interface ProposalCardData {
  id: string;
  kind: string;
  status: ProposalStatus;
  preview: string;
  requesterName: string | null;
  createdLabel: string;
  expiresLabel: string;
  /** REPORT line for decided proposals (core's summary or failure reason). */
  outcome: string | null;
}

export interface ProposalDecision {
  canConfirm: boolean;
  isOwn: boolean;
  confirmAction: FormAction;
  rejectAction: FormAction;
}

const KIND_COPY: Readonly<Record<string, { consequence: string; confirmLabel: string }>> = {
  create_task: {
    consequence: 'Creates a mission in DRAFT, invisible to members until staff publish it.',
    confirmLabel: 'Create draft mission',
  },
  draft_announcement: {
    consequence: 'Posts to the announcements channel through the bot, without pings.',
    confirmLabel: 'Post announcement',
  },
  create_research_item: {
    consequence: 'Saves the reference to the research library as NEW, for review.',
    confirmLabel: 'Save to library',
  },
};
const DEFAULT_COPY = { consequence: 'Executes the proposed action.', confirmLabel: 'Confirm' };

/** PREVIEW, and — while pending — CONFIRM / REJECT for someone allowed to decide. */
export function ProposalCard({
  proposal,
  decision,
}: {
  proposal: ProposalCardData;
  decision: ProposalDecision | null;
}) {
  const copy = KIND_COPY[proposal.kind] ?? DEFAULT_COPY;
  const label = kindLabel(proposal.kind);
  return (
    <article
      data-proposal={proposal.id}
      aria-label={`${label} proposal`}
      className="space-y-3 px-5 py-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="type-eyebrow text-fg">{label}</span>
          <StatusBadge
            tone={PROPOSAL_STATUS_TONE[proposal.status]}
            label={PROPOSAL_STATUS_LABELS[proposal.status].toUpperCase()}
          />
        </div>
        <Mono dim className="text-[12px]">
          {proposal.requesterName ? `${proposal.requesterName} · ` : ''}
          {proposal.createdLabel}
        </Mono>
      </div>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-line-subtle bg-surface-sunken p-3 font-mono text-[12px] leading-relaxed text-fg-muted">
        {proposal.preview}
      </pre>
      {proposal.outcome ? <p className="text-small text-fg-muted">{proposal.outcome}</p> : null}
      {proposal.status === 'pending' ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-small text-fg-subtle">Expires {proposal.expiresLabel}</p>
          {decision ? (
            <ProposalActions
              proposalId={proposal.id}
              kindLabel={label}
              preview={proposal.preview}
              consequence={copy.consequence}
              confirmLabel={copy.confirmLabel}
              canConfirm={decision.canConfirm}
              isOwn={decision.isOwn}
              confirmAction={decision.confirmAction}
              rejectAction={decision.rejectAction}
            />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
