import type { Metadata } from 'next';
import { z } from 'zod';
import { ai, can } from '@jave/core';
import { Badge, LinkTabs, Mono, PageHeader } from '@jave/ui';
import { NextLink } from '@/components/next-link';
import { RestrictedPage } from '@/components/restricted-page';
import { AI_REQUEST_STATUS_LABELS, type AiRequestStatus } from '@/lib/ai-labels';
import { firstParam, offsetParam, type SearchParams } from '@/lib/search-params';
import { requireConsoleContext, type UserContext } from '@/server/context';
import { loadViewer } from '@/server/data/viewer';
import { LedgerSection } from './ledger-section';
import { OverviewSection } from './overview-section';
import { ProposalsSection } from './proposals-section';

export const metadata: Metadata = { title: 'JAVE AI' };

const TABS = ['overview', 'proposals', 'ledger'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview',
  proposals: 'Proposals',
  ledger: 'Request ledger',
};

const TAB_HREFS: Record<Tab, string> = {
  overview: '/ai',
  proposals: '/ai?tab=proposals',
  ledger: '/ai?tab=ledger',
};

const ledgerFilterSchema = z.object({
  feature: z.enum(ai.AI_FEATURES).optional().catch(undefined),
  status: z
    .enum(Object.keys(AI_REQUEST_STATUS_LABELS) as [AiRequestStatus, ...AiRequestStatus[]])
    .optional()
    .catch(undefined),
});

/** The badge only needs the queue's total, not its rows. */
const BADGE_ROWS = 1;

/** Other members' live proposals the viewer may confirm: the same queue the tab lists. */
async function awaitingCount(ctx: UserContext): Promise<number> {
  if (!can(ctx, 'canConfirmAIActions')) return 0;
  const queue = await ai.listProposals(ctx, { scope: 'to_confirm', limit: BADGE_ROWS });
  return queue.total;
}

export default async function AiPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { ctx } = await requireConsoleContext();
  if (!can(ctx, 'canUseAI')) {
    return <RestrictedPage eyebrow="INTELLIGENCE" title="JAVE AI" capability="canUseAI" />;
  }
  const params = await searchParams;
  const requested = firstParam(params.tab);
  const tab: Tab = TABS.find((candidate) => candidate === requested) ?? 'overview';
  const offset = offsetParam(params.offset);
  const [viewer, awaiting] = await Promise.all([loadViewer(ctx), awaitingCount(ctx)]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="INTELLIGENCE"
        title="JAVE AI"
        description="Answers, drafts and proposals. AI can only propose: a human with the right capability confirms anything that changes state."
        meta={<Mono dim>PREVIEW → CONFIRM → EXECUTE → REPORT</Mono>}
      />
      <LinkTabs
        label="JAVE AI sections"
        linkComponent={NextLink}
        tabs={TABS.map((key) => ({
          href: TAB_HREFS[key],
          label: TAB_LABELS[key],
          active: key === tab,
          meta:
            key === 'proposals' && awaiting > 0 ? (
              <Badge tone="info" aria-label={`${awaiting} awaiting your confirmation`}>
                {awaiting}
              </Badge>
            ) : undefined,
        }))}
      />
      {tab === 'overview' ? <OverviewSection ctx={ctx} timeZone={viewer.timeZone} /> : null}
      {tab === 'proposals' ? (
        <ProposalsSection
          ctx={ctx}
          timeZone={viewer.timeZone}
          offset={offset}
          queueOffset={offsetParam(params.queue)}
        />
      ) : null}
      {tab === 'ledger' ? (
        <LedgerSection
          ctx={ctx}
          timeZone={viewer.timeZone}
          offset={offset}
          filters={ledgerFilterSchema.parse({
            feature: firstParam(params.feature) || undefined,
            status: firstParam(params.status) || undefined,
          })}
        />
      ) : null}
    </div>
  );
}
