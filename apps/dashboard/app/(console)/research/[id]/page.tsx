import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { can, isUuid, research, userNames } from '@jave/core';
import { Badge, Callout, Icon, Mono, Panel, StatusBadge } from '@jave/ui';
import { type Fact, FactList } from '@/components/fact-list';
import { ItemActions } from '@/components/research/item-actions';
import { ReviewForm } from '@/components/research/review-form';
import {
  arxivUrl,
  discordMessageUrl,
  doiUrl,
  ENRICHMENT_LABELS,
  EVIDENCE_LABELS,
  RESEARCH_STATUS_LABELS,
  RESEARCH_STATUS_TONE,
  REVIEW_STATUSES,
  type ReviewStatus,
  SIDUS_INTEGRATION_LABELS,
  SIDUS_SYNC_LABELS,
  SIDUS_SYNC_TONE,
  sidusIntegrationState,
} from '@/lib/research-labels';
import { safeExternalUrl } from '@/lib/safe-url';
import { formatTimestamp } from '@/lib/time';
import { getIntegrations } from '@/server/ai';
import { requireConsoleContext } from '@/server/context';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';
import { archiveResearchAction, requestSidusSyncAction, reviewResearchAction } from '../actions';

export const metadata: Metadata = { title: 'Research item' };

function ExternalAnchor({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="inline-flex max-w-full items-center gap-1 break-all text-fg underline-offset-4 hover:underline"
    >
      <Mono className="break-all">{children}</Mono>
      <Icon icon={ExternalLink} size="sm" className="shrink-0 text-fg-subtle" />
    </a>
  );
}

/** A link that is safe to show as a public reference: http(s) and never a Discord link. */
function publicReference(url: string | null): string | null {
  const safe = safeExternalUrl(url);
  return safe && !research.isDiscordUrl(safe) ? safe : null;
}

export default async function ResearchItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireConsoleContext();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const loaded = await guarded(() => research.getResearchItem(ctx, { itemId: id }));
  if (!loaded.ok) notFound();
  const item = loaded.value;
  const [viewer, names] = await Promise.all([
    loadViewer(ctx),
    userNames(
      ctx,
      [item.submittedByUserId, item.reviewedByUserId].filter((value): value is string =>
        Boolean(value),
      ),
    ),
  ]);
  const tz = viewer.timeZone;
  const own = item.submittedByUserId === ctx.actor.userId;
  const reviewer = can(ctx, 'canReviewResearch');
  const integrations = getIntegrations();
  const sidusState = sidusIntegrationState(integrations);
  const diagnostics = can(ctx, 'canViewSystemStatus');
  const source = publicReference(item.url);
  const message = discordMessageUrl(item.discordMessageUrl);
  const currentReviewStatus = (REVIEW_STATUSES as readonly string[]).includes(item.status)
    ? (item.status as ReviewStatus)
    : null;

  const reference: Fact[] = [
    {
      label: 'DOI',
      value: item.doi ? <ExternalAnchor href={doiUrl(item.doi)}>{item.doi}</ExternalAnchor> : '—',
    },
    {
      label: 'ARXIV',
      value: item.arxivId ? (
        <ExternalAnchor href={arxivUrl(item.arxivId)}>{item.arxivId}</ExternalAnchor>
      ) : (
        '—'
      ),
    },
    {
      label: 'LINK',
      value: source ? (
        <ExternalAnchor href={source}>{new URL(source).hostname}</ExternalAnchor>
      ) : item.url ? (
        'Discord attachment (not a public reference)'
      ) : (
        '—'
      ),
    },
    { label: 'VENUE', value: item.source ?? '—' },
    { label: 'PUBLISHED', value: item.publishedOn ? <Mono>{item.publishedOn}</Mono> : '—' },
  ];
  const provenance: Fact[] = [
    {
      label: 'SUBMITTED BY',
      value: names.get(item.submittedByUserId)?.displayName ?? 'Unknown member',
    },
    { label: 'ADDED', value: <Mono dim>{formatTimestamp(item.createdAt, tz)}</Mono> },
    {
      label: 'ORIGIN',
      value: message ? (
        <a
          href={message}
          target="_blank"
          rel="noopener noreferrer"
          className="text-fg underline-offset-4 hover:underline"
        >
          Discord message
        </a>
      ) : (
        'Added by hand or through JAVE AI'
      ),
    },
    {
      label: 'METADATA',
      value: `${ENRICHMENT_LABELS[item.enrichmentStatus]}${item.enrichmentError ? ` — ${item.enrichmentError}` : ''}`,
    },
    {
      label: 'REVIEWED',
      value: item.reviewedAt
        ? `${formatTimestamp(item.reviewedAt, tz)} · ${
            (item.reviewedByUserId && names.get(item.reviewedByUserId)?.displayName) ?? 'reviewer'
          }`
        : 'Not yet',
    },
    { label: 'VERSION', value: <Mono dim>v{item.version}</Mono> },
  ];
  const sidus: Fact[] = [
    {
      label: 'STATUS',
      value: (
        <StatusBadge
          tone={SIDUS_SYNC_TONE[item.sidusSyncStatus]}
          label={SIDUS_SYNC_LABELS[item.sidusSyncStatus].toUpperCase()}
        />
      ),
    },
    {
      label: 'EXTERNAL ID',
      value: item.sidusExternalId ? <Mono>{item.sidusExternalId}</Mono> : '—',
    },
    {
      label: 'LAST PUSH',
      value: item.sidusSyncedAt ? <Mono dim>{formatTimestamp(item.sidusSyncedAt, tz)}</Mono> : '—',
    },
    {
      label: 'INTEGRATION',
      value:
        diagnostics && integrations.sidusConfigurationError
          ? `${SIDUS_INTEGRATION_LABELS[sidusState]} — ${integrations.sidusConfigurationError}`
          : SIDUS_INTEGRATION_LABELS[sidusState],
    },
  ];

  return (
    <div className="space-y-8">
      <header className="space-y-4 border-b border-line-subtle pb-7">
        <Link
          href="/research"
          className="inline-flex items-center gap-1.5 text-small text-fg-subtle hover:text-fg"
        >
          <Icon icon={ArrowLeft} size="sm" />
          Research library
        </Link>
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0 space-y-2.5">
            <p className="type-eyebrow text-fg-subtle">INTELLIGENCE / RESEARCH ITEM</p>
            <h1 className="break-words text-[24px] font-semibold leading-tight tracking-tight text-fg">
              {item.title}
            </h1>
            {item.authors.length > 0 ? (
              <p className="text-body text-fg-muted">{item.authors.join(', ')}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                tone={RESEARCH_STATUS_TONE[item.status]}
                label={RESEARCH_STATUS_LABELS[item.status].toUpperCase()}
              />
              <Badge>EVIDENCE · {EVIDENCE_LABELS[item.evidenceLevel].toUpperCase()}</Badge>
              {item.topic ? <Badge tone="info">{item.topic}</Badge> : null}
              {item.tags.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
            </div>
          </div>
          <ItemActions
            itemId={item.id}
            canArchive={
              item.status !== 'archived' && (reviewer || (own && ctx.actor.standing === 'good'))
            }
            canPush={reviewer && !own && item.status === 'verified'}
            archiveAction={archiveResearchAction}
            pushAction={requestSidusSyncAction}
          />
        </div>
        {item.titleGuessed ? (
          <Callout tone="info">
            The title was guessed from the message. Metadata lookup or a reviewer may correct it.
          </Callout>
        ) : null}
      </header>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Panel title="Summary">
            {item.summary ? (
              <p className="whitespace-pre-wrap text-body leading-relaxed text-fg-muted">
                {item.summary}
              </p>
            ) : (
              <p className="text-small text-fg-subtle">No summary yet. Reviewers can add one.</p>
            )}
          </Panel>
          {reviewer && !own ? (
            <Panel
              title={item.status === 'archived' ? 'Restore' : 'Review'}
              description="Your decision applies to the version on screen. The submitter is notified when an item becomes REVIEWED or VERIFIED."
            >
              <ReviewForm
                action={reviewResearchAction}
                itemId={item.id}
                version={item.version}
                archived={item.status === 'archived'}
                current={{
                  status: currentReviewStatus,
                  evidenceLevel: item.evidenceLevel,
                  topic: item.topic,
                  tags: item.tags,
                  summary: item.summary,
                }}
              />
            </Panel>
          ) : null}
          {reviewer && own ? (
            <Callout tone="neutral" title="YOUR SUBMISSION">
              Nobody reviews their own submission. Another reviewer decides its status and evidence
              level.
            </Callout>
          ) : null}
        </div>
        <div className="space-y-6">
          <Panel title="Reference">
            <FactList facts={reference} />
          </Panel>
          <Panel
            title="Sidus sync"
            description="Only VERIFIED items are pushed. No member identity leaves JAVE."
          >
            <FactList facts={sidus} />
            {item.sidusSyncError ? (
              <p className="mt-3 text-small text-fg-subtle">{item.sidusSyncError}</p>
            ) : null}
          </Panel>
          <Panel title="Provenance">
            <FactList facts={provenance} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
