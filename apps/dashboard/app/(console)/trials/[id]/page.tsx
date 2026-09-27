import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { can, ForbiddenError, isUuid, loadCatalog, NotFoundError, trials } from '@jave/core';
import { Badge, buttonStyles, Card, Icon, LinkTabs, Mono, RestrictedState } from '@jave/ui';
import { NextLink } from '@/components/next-link';
import { TrialClock } from '@/components/trials/trial-clock';
import { TrialStatusBadge } from '@/components/trials/trial-status-badge';
import { firstParam, type SearchParams } from '@/lib/search-params';
import { categoryLabel } from '@/lib/trial-labels';
import { requireConsoleContext, type UserContext } from '@/server/context';
import { isTrialStaff } from '@/server/data/trials';
import { loadViewer } from '@/server/data/viewer';
import { AdversarialTab } from './adversarial-tab';
import { OverviewTab } from './overview-tab';
import { ParticipantsTab, SubmissionsTab, TeamsTab } from './roster-tabs';
import { EvaluationTab, ResultsTab } from './scoring-tabs';

export const metadata: Metadata = { title: 'Trial' };

const TABS = [
  'overview',
  'participants',
  'teams',
  'submissions',
  'evaluation',
  'results',
  'adversarial',
] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview',
  participants: 'Participants',
  teams: 'Teams',
  submissions: 'Submissions',
  evaluation: 'Evaluation',
  results: 'Results',
  adversarial: 'Adversarial',
};

type Loaded = { view: trials.StaffTrialView } | { refused: string };

/**
 * The staff view, or the service's refusal. A conflict of interest (the
 * viewer applied to this trial) is a calm refusal with its reason, not an error.
 */
async function loadStaffView(ctx: UserContext, trialId: string): Promise<Loaded> {
  try {
    return { view: await trials.getTrialForStaff(ctx, { trialId }) };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) return { refused: error.userMessage };
    throw error;
  }
}

function RefusedPage({ reason }: { reason: string }) {
  return (
    <div className="space-y-8">
      <Link href="/trials" className={buttonStyles({ variant: 'ghost', className: '-ml-3' })}>
        <Icon icon={ArrowLeft} size="sm" />
        Trials
      </Link>
      <Card padding="none">
        <RestrictedState
          description={reason}
          requirement="canManageTrials · canEvaluateTrials · no stake in this trial"
        />
      </Card>
    </div>
  );
}

export default async function TrialPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireConsoleContext();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  if (!isTrialStaff(ctx)) return <RefusedPage reason="Trial records are for trial staff." />;
  const loaded = await loadStaffView(ctx, id);
  if ('refused' in loaded) return <RefusedPage reason={loaded.refused} />;
  const { view } = loaded;
  const query = await searchParams;
  const [viewer, catalog] = await Promise.all([loadViewer(ctx), loadCatalog(ctx)]);
  const available = TABS.filter((tab) => tab !== 'adversarial' || can(ctx, 'canManageAdversarial'));
  const requested = firstParam(query.tab) as Tab | undefined;
  const tab: Tab = requested && available.includes(requested) ? requested : 'overview';
  const facetLabels = new Map(catalog.facets.map((facet) => [facet.key, facet.label]));
  const domainLabels = new Map(catalog.domains.map((domain) => [domain.key, domain.label]));
  const submissions = view.teams.reduce((sum, team) => sum + team.submissions.length, 0);
  const counts: Partial<Record<Tab, number>> = {
    participants: view.participants.length,
    teams: view.teams.length,
    submissions,
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-6 border-b border-line-subtle pb-8 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 space-y-3">
          <p className="type-eyebrow flex flex-wrap items-center gap-x-2 text-fg-subtle">
            <Link href="/trials" className="hover:text-fg">
              OPERATIONS / TRIALS
            </Link>
            <span aria-hidden>/</span>
            <span>{view.ref}</span>
          </p>
          <h1 className="break-words text-[26px] font-semibold leading-tight tracking-tight text-fg">
            {view.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <TrialStatusBadge status={view.status} />
            <Badge>{categoryLabel(view.category)}</Badge>
            <Mono dim>
              teams of {view.teamSize} · {trials.formatDuration(view.durationMinutes)}
            </Mono>
          </div>
          <p className="max-w-2xl text-body text-fg-subtle">
            {view.summary || 'No public summary yet.'}
          </p>
        </div>
        <div className="shrink-0 md:text-right">
          <TrialClock trial={view} now={ctx.clock.now()} timeZone={viewer.timeZone} stacked />
        </div>
      </header>

      <div className="space-y-6">
        <LinkTabs
          label="Trial sections"
          linkComponent={NextLink}
          tabs={available.map((key) => ({
            href: key === 'overview' ? `/trials/${view.id}` : `/trials/${view.id}?tab=${key}`,
            label: TAB_LABELS[key],
            active: key === tab,
            meta: counts[key] !== undefined ? <Mono dim>{counts[key]}</Mono> : undefined,
          }))}
        />
        {tab === 'overview' ? (
          <OverviewTab ctx={ctx} view={view} facetLabels={facetLabels} timeZone={viewer.timeZone} />
        ) : null}
        {tab === 'participants' ? (
          <ParticipantsTab
            ctx={ctx}
            view={view}
            timeZone={viewer.timeZone}
            domainLabels={domainLabels}
          />
        ) : null}
        {tab === 'teams' ? <TeamsTab ctx={ctx} view={view} params={query} /> : null}
        {tab === 'submissions' ? <SubmissionsTab view={view} timeZone={viewer.timeZone} /> : null}
        {tab === 'evaluation' ? <EvaluationTab ctx={ctx} view={view} viewer={viewer} /> : null}
        {tab === 'results' ? (
          <ResultsTab ctx={ctx} view={view} viewer={viewer} catalog={catalog} />
        ) : null}
        {tab === 'adversarial' ? <AdversarialTab ctx={ctx} view={view} viewer={viewer} /> : null}
      </div>
    </div>
  );
}
