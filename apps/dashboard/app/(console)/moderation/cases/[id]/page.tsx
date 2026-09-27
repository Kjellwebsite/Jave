import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, UserSearch } from 'lucide-react';
import {
  can,
  ForbiddenError,
  isUuid,
  moderation,
  NotFoundError,
  type ServiceContext,
} from '@jave/core';
import {
  Badge,
  buttonStyles,
  Callout,
  Icon,
  Mono,
  PageHeader,
  Panel,
  StatusBadge,
  Timeline,
  type TimelineItem,
} from '@jave/ui';
import { RevokeCaseDialog } from '@/components/moderation/moderation-dialogs';
import { RestrictedPage } from '@/components/restricted-page';
import {
  CASE_ACTION_LABELS,
  CASE_ACTION_TONE,
  CASE_SOURCE_LABELS,
  caseState,
  END_REASON_LABELS,
  REVERSAL_ACTIONS,
  SYNC_EXPLANATION,
  SYNC_LABELS,
  SYNC_QUIET,
  SYNC_TONE,
} from '@/lib/moderation-labels';
import { toQueryString } from '@/lib/search-params';
import { formatTimestamp } from '@/lib/time';
import { requireConsoleContext } from '@/server/context';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';
import { revokeCaseAction } from '../../actions';

export const metadata: Metadata = { title: 'Case' };

type CaseView = moderation.ModCaseView;

/** Linked records the viewer may also read; anything hidden from them stays hidden. */
async function loadLinks(ctx: ServiceContext, view: CaseView) {
  const quiet = <T,>(load: () => Promise<T>) =>
    load().catch((error: unknown) => {
      if (error instanceof NotFoundError || error instanceof ForbiddenError) return null;
      throw error;
    });
  const [reverted, event] = await Promise.all([
    view.revertsCaseId ? quiet(() => moderation.getCase(ctx, view.revertsCaseId!)) : null,
    view.securityEventId && can(ctx, 'canViewSecurityEvents')
      ? quiet(() => moderation.getSecurityEvent(ctx, view.securityEventId!))
      : null,
  ]);
  return { reverted, event };
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="type-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-1.5 min-w-0 text-small text-fg">{children}</dd>
    </div>
  );
}

function timelineFor(view: CaseView, timeZone: string): TimelineItem[] {
  const items: TimelineItem[] = [
    {
      id: 'created',
      title: 'Recorded',
      at: view.createdAt,
      atLabel: formatTimestamp(view.createdAt, timeZone),
      description: view.moderator
        ? `By ${view.moderator.name}.`
        : `By ${CASE_SOURCE_LABELS[view.source].toLowerCase()}.`,
    },
  ];
  // Only successful syncs carry a time; failures are shown in the Discord panel.
  if (view.discordSync === 'applied' && view.discordSyncedAt) {
    items.push({
      id: 'synced',
      title: 'Applied in Discord',
      at: view.discordSyncedAt,
      atLabel: formatTimestamp(view.discordSyncedAt, timeZone),
      tone: 'success',
    });
  }
  if (view.endedAt && view.endedReason) {
    items.push({
      id: 'ended',
      title: `Ended — ${END_REASON_LABELS[view.endedReason].toLowerCase()}`,
      at: view.endedAt,
      atLabel: formatTimestamp(view.endedAt, timeZone),
    });
  }
  if (view.revokedAt) {
    items.push({
      id: 'revoked',
      title: 'Revoked',
      at: view.revokedAt,
      atLabel: formatTimestamp(view.revokedAt, timeZone),
      description: view.revokedBy ? `By ${view.revokedBy.name}.` : undefined,
      tone: 'warning',
    });
  }
  return items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireConsoleContext();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const loaded = await guarded(() => moderation.getCase(ctx, id));
  if (!loaded.ok) {
    return (
      <RestrictedPage eyebrow="SUPPORT & SAFETY" title="Moderation" capability="canModerate" />
    );
  }
  const view = loaded.value;
  const [viewer, links] = await Promise.all([loadViewer(ctx), loadLinks(ctx, view)]);
  const tz = viewer.timeZone;
  const state = caseState(view);
  // Reversals are never revoked; the dialog stays mounted after a revoke so its result is announced.
  const revocable =
    !REVERSAL_ACTIONS.includes(view.action) && can(ctx, moderation.CASE_CAPABILITY[view.action]);
  const lookupHref = `/moderation${toQueryString({ tab: 'lookup', q: view.target.discordId })}`;

  return (
    <div className="space-y-8">
      <Link
        href="/moderation"
        className="inline-flex items-center gap-1.5 text-small text-fg-subtle transition-colors hover:text-fg"
      >
        <Icon icon={ArrowLeft} size="sm" />
        All cases
      </Link>
      <PageHeader
        eyebrow="SUPPORT & SAFETY / CASE"
        title={view.reference}
        description={`${CASE_ACTION_LABELS[view.action]} — ${view.target.name}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={lookupHref} className={buttonStyles({ variant: 'secondary' })}>
              <Icon icon={UserSearch} size="sm" />
              Member record
            </Link>
            {revocable ? (
              <RevokeCaseDialog
                caseId={view.id}
                reference={view.reference}
                action={view.action}
                inForce={view.inForce}
                available={!view.revokedAt}
                revokeAction={revokeCaseAction}
              />
            ) : null}
          </div>
        }
      />

      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
        <Fact label="ACTION">
          <Badge tone={CASE_ACTION_TONE[view.action]}>{CASE_ACTION_LABELS[view.action]}</Badge>
        </Fact>
        <Fact label="STATE">
          <StatusBadge tone={state.tone} quiet={state.quiet} label={state.label} />
        </Fact>
        <Fact label="MEMBER">
          <span className="block truncate">{view.target.name}</span>
          <Mono dim className="block truncate text-[12px]">
            {view.target.discordId}
          </Mono>
        </Fact>
        <Fact label="MODERATOR">
          {view.moderator ? (
            view.moderator.name
          ) : (
            <span className="text-fg-subtle">{CASE_SOURCE_LABELS[view.source]}</span>
          )}
        </Fact>
        <Fact label="SOURCE">{CASE_SOURCE_LABELS[view.source]}</Fact>
        <Fact label={view.expiresAt ? 'ENDS' : 'DURATION'}>
          {view.expiresAt ? (
            <Mono>{formatTimestamp(view.expiresAt, tz)}</Mono>
          ) : view.durationSeconds ? (
            <Mono>{moderation.formatDuration(view.durationSeconds)}</Mono>
          ) : (
            <span className="text-fg-subtle">
              {view.action === 'quarantine' || view.action === 'ban' ? 'Until lifted' : '—'}
            </span>
          )}
        </Fact>
      </dl>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Panel
            title="Reason"
            description="Shown to the member with the notice, except for notes."
          >
            <p className="whitespace-pre-wrap break-words text-body text-fg">{view.reason}</p>
            {view.deleteMessageDays ? (
              <p className="mt-3 text-small text-fg-subtle">
                Deleted the last {view.deleteMessageDays} day
                {view.deleteMessageDays === 1 ? '' : 's'} of messages.
              </p>
            ) : null}
          </Panel>
          {view.revokedAt ? (
            <Panel title="Revocation">
              <p className="whitespace-pre-wrap break-words text-body text-fg">
                {view.revokeReason}
              </p>
              <p className="mt-3 text-small text-fg-subtle">
                {view.revokedBy ? `${view.revokedBy.name} · ` : ''}
                <Mono dim>{formatTimestamp(view.revokedAt, tz)}</Mono>
              </p>
            </Panel>
          ) : null}
          {links.reverted || links.event ? (
            <Panel title="Linked records" flush>
              <ul className="divide-y divide-line-subtle">
                {links.reverted ? (
                  <li>
                    <Link
                      href={`/moderation/cases/${links.reverted.id}`}
                      className="flex items-center justify-between gap-4 px-5 py-3 text-small transition-colors hover:bg-surface-raised/60"
                    >
                      <span className="text-fg-muted">Lifts</span>
                      <Mono>{links.reverted.reference}</Mono>
                    </Link>
                  </li>
                ) : null}
                {links.event ? (
                  <li>
                    <Link
                      href={`/moderation/security/${links.event.id}`}
                      className="flex items-center justify-between gap-4 px-5 py-3 text-small transition-colors hover:bg-surface-raised/60"
                    >
                      <span className="text-fg-muted">Security event</span>
                      <Mono>{links.event.reference}</Mono>
                    </Link>
                  </li>
                ) : null}
              </ul>
            </Panel>
          ) : null}
        </div>

        <div className="min-w-0 space-y-6">
          <Panel title="Discord" description="The bot applies every case and reports back.">
            <div className="space-y-3">
              <StatusBadge
                tone={SYNC_TONE[view.discordSync]}
                quiet={SYNC_QUIET[view.discordSync]}
                label={SYNC_LABELS[view.discordSync]}
                data-testid="discord-sync"
              />
              <p className="text-small text-fg-subtle">{SYNC_EXPLANATION[view.discordSync]}</p>
              {view.discordSync === 'failed' && view.discordError ? (
                <Callout tone="danger" title="Discord said">
                  <span className="break-words">{view.discordError}</span>
                </Callout>
              ) : null}
            </div>
          </Panel>
          <Panel title="Timeline">
            <Timeline items={timelineFor(view, tz)} label={`${view.reference} timeline`} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
