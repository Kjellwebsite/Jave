import { Inbox, Sparkles } from 'lucide-react';
import { ai, CAPABILITY_KEYS, type Capability, can, getSettings, userNames } from '@jave/core';
import { cx, EmptyState, Pagination, Panel } from '@jave/ui';
import { DraftForm } from '@/components/ai/draft-form';
import {
  ProposalCard,
  type ProposalCardData,
  type ProposalDecision,
} from '@/components/ai/proposal-card';
import { NextLink } from '@/components/next-link';
import { toQueryString } from '@/lib/search-params';
import { formatRelative, formatTimestamp } from '@/lib/time';
import type { UserContext } from '@/server/context';
import { getProviderStatus } from '@/server/ai';
import {
  confirmProposalAction,
  draftAnnouncementAction,
  draftMissionAction,
  rejectProposalAction,
} from './actions';

export const PROPOSALS_PAGE_SIZE = 10;
const QUEUE_LIMIT = 25;

function holds(ctx: UserContext, capability: string): boolean {
  return (CAPABILITY_KEYS as readonly string[]).includes(capability)
    ? can(ctx, capability as Capability)
    : false;
}

function outcomeOf(proposal: ai.ProposalView): string | null {
  const summary = proposal.result?.summary;
  switch (proposal.status) {
    case 'executed':
    case 'confirmed':
      return typeof summary === 'string' ? summary : null;
    case 'failed':
      return proposal.error ? `Not executed: ${proposal.error}` : 'Not executed.';
    case 'rejected': {
      const reason = proposal.result?.reason;
      return typeof reason === 'string' && reason ? `Rejected: ${reason}` : 'Rejected.';
    }
    case 'expired':
      return 'Expired before anyone confirmed it. Nothing was executed.';
    default:
      return null;
  }
}

function cardData(
  proposal: ai.ProposalView,
  names: Map<string, { displayName: string }>,
  now: Date,
  timeZone: string,
): ProposalCardData {
  return {
    id: proposal.id,
    kind: proposal.kind,
    status: proposal.status,
    preview: proposal.preview,
    requesterName: names.get(proposal.requestedByUserId)?.displayName ?? null,
    createdLabel: formatRelative(proposal.createdAt, now, timeZone),
    expiresLabel: formatTimestamp(proposal.expiresAt, timeZone),
    outcome: outcomeOf(proposal),
  };
}

/**
 * PREVIEW → CONFIRM → EXECUTE → REPORT on the dashboard: proposals awaiting
 * the viewer's confirmation, the viewer's own proposals, and draft forms for
 * the kinds the viewer may propose. Buttons appear only where core would allow them.
 */
export async function ProposalsSection({
  ctx,
  timeZone,
  offset,
}: {
  ctx: UserContext;
  timeZone: string;
  offset: number;
}) {
  const userId = ctx.actor.userId;
  const [queue, mine, settings, status] = await Promise.all([
    can(ctx, 'canConfirmAIActions')
      ? ai.listProposals(ctx, { scope: 'to_confirm', limit: QUEUE_LIMIT })
      : null,
    ai.listProposals(ctx, { scope: 'mine', limit: PROPOSALS_PAGE_SIZE, offset }),
    getSettings(ctx, 'ai'),
    getProviderStatus(),
  ]);
  const awaiting = (queue?.items ?? []).filter((item) => item.requestedByUserId !== userId);
  const names = await userNames(
    ctx,
    awaiting.map((item) => item.requestedByUserId),
  );
  const now = ctx.clock.now();
  const decisionFor = (proposal: ai.ProposalView, own: boolean): ProposalDecision => ({
    canConfirm: own ? holds(ctx, proposal.capabilityToConfirm) : true,
    isOwn: own,
    confirmAction: confirmProposalAction,
    rejectAction: rejectProposalAction,
  });
  const canDraftAnnouncement = can(ctx, 'canBroadcast');
  const canDraftMission = can(ctx, 'canManageMissions');
  const canDraft = canDraftAnnouncement || canDraftMission;
  const draftingAvailable = settings.enabled && status.state !== 'disabled';

  return (
    <div className="space-y-8">
      {queue ? (
        <Panel
          title="Awaiting your confirmation"
          description="Drafted by other members. Confirming executes exactly the preview, as you."
          flush
        >
          {awaiting.length === 0 ? (
            <EmptyState
              compact
              icon={Inbox}
              title="NOTHING TO CONFIRM"
              description="Pending proposals you are allowed to confirm appear here."
            />
          ) : (
            <div className="divide-y divide-line-subtle">
              {awaiting.map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposal={cardData(proposal, names, now, timeZone)}
                  decision={decisionFor(proposal, false)}
                />
              ))}
            </div>
          )}
        </Panel>
      ) : null}

      <div
        className={cx(
          'grid grid-cols-1 items-start gap-6',
          canDraft && 'xl:grid-cols-[minmax(0,1fr)_380px]',
        )}
      >
        <Panel
          title="Your proposals"
          description="What JAVE AI drafted for you, and what happened to it."
          flush
        >
          {mine.items.length === 0 ? (
            <EmptyState
              compact
              icon={Sparkles}
              title="NO PROPOSALS YET"
              description={
                canDraft
                  ? 'Draft an announcement or a mission: it waits here as a pending proposal. Nothing runs until someone confirms.'
                  : 'Proposals JAVE AI drafts for you wait here. Nothing runs until someone confirms.'
              }
            />
          ) : (
            <div className="divide-y divide-line-subtle">
              {mine.items.map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposal={cardData(proposal, new Map(), now, timeZone)}
                  decision={decisionFor(proposal, true)}
                />
              ))}
            </div>
          )}
          {mine.total > PROPOSALS_PAGE_SIZE ? (
            <div className="border-t border-line-subtle px-5 py-3">
              <Pagination
                offset={mine.offset}
                limit={mine.limit}
                total={mine.total}
                linkComponent={NextLink}
                hrefForOffset={(next) =>
                  `/ai${toQueryString({ tab: 'proposals', offset: next || undefined })}`
                }
              />
            </div>
          ) : null}
        </Panel>

        {canDraft ? (
          <Panel
            title="Draft with JAVE AI"
            description="The model drafts; JAVE stores a pending proposal with a preview. Nothing executes until a human confirms."
          >
            {draftingAvailable ? (
              <div className="space-y-8">
                {canDraftAnnouncement ? (
                  <DraftForm
                    action={draftAnnouncementAction}
                    label="Announcement brief"
                    description="What to announce, to whom, and when. Posted without pings after confirmation."
                    placeholder="Trial week starts Monday 18:00 UTC. Applications close Sunday."
                    submitLabel="Draft announcement"
                  />
                ) : null}
                {canDraftMission ? (
                  <DraftForm
                    action={draftMissionAction}
                    label="Mission brief"
                    description="The goal and the evidence that proves completion. Created as DRAFT after confirmation."
                    placeholder="Decode the CubeSat beacon format and publish decoded frames."
                    submitLabel="Draft mission"
                  />
                ) : null}
              </div>
            ) : (
              <p className="text-small text-fg-subtle">
                Drafting needs JAVE AI. It is disabled on this deployment or in settings.
              </p>
            )}
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
