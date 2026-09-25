import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { can, getProfile, listAuditLogs, listMembers, type DomainSummary } from '@jave/core';
import {
  Avatar,
  cx,
  EmptyState,
  Icon,
  Mono,
  PageHeader,
  Panel,
  RankBadge,
  RoleBadge,
  Stat,
} from '@jave/ui';
import { AuditResultBadge } from '@/components/audit/audit-result-badge';
import { NextLink } from '@/components/next-link';
import { formatRelative, formatTimestamp } from '@/lib/time';
import { requireConsoleContext } from '@/server/context';
import {
  JOIN_WINDOW_DAYS,
  loadOverviewMetrics,
  type OverviewMetricKey,
} from '@/server/data/overview';
import { loadViewer } from '@/server/data/viewer';

export const metadata: Metadata = { title: 'Overview' };

const RECENT_AUDIT_LIMIT = 8;
const NEWEST_MEMBERS_LIMIT = 6;

const METRIC_COPY: Record<OverviewMetricKey, { label: string; hint: string; href?: string }> = {
  membersPresent: {
    label: 'MEMBERS PRESENT',
    hint: 'In the Discord guild now',
    href: '/members?status=present',
  },
  joinedRecently: {
    label: `JOINED · ${JOIN_WINDOW_DAYS}D`,
    hint: `New in the last ${JOIN_WINDOW_DAYS} days`,
  },
  openApplications: { label: 'OPEN APPLICATIONS', hint: 'Submitted, in review or interview' },
  activeTrials: { label: 'ACTIVE TRIALS', hint: 'Running now' },
  openTickets: { label: 'OPEN TICKETS', hint: 'Open, claimed or waiting' },
  openSecurityEvents: { label: 'SECURITY EVENTS', hint: 'Open, awaiting triage' },
  verifiedCapabilities: {
    label: 'VERIFIED CAPABILITIES',
    hint: 'Facet ranks set by evaluators',
    href: '/ranking',
  },
  projectsShipped: { label: 'PROJECTS SHIPPED', hint: 'Marked shipped' },
};

/**
 * Wide-screen tile columns by how many metrics the actor may see (8 staff,
 * 5 members), so the grid never ends on a lone tile. Phones use two columns
 * and let an odd last tile span both.
 */
const METRIC_COLUMNS: Readonly<Record<number, string>> = {
  3: 'lg:grid-cols-3',
  5: 'lg:grid-cols-3 xl:grid-cols-5',
  6: 'lg:grid-cols-3',
};
const DEFAULT_METRIC_COLUMNS = 'lg:grid-cols-4';

function DomainRow({ domain }: { domain: DomainSummary }) {
  return (
    <li className="flex items-center justify-between gap-4 py-2.5">
      <span className="type-eyebrow text-fg-muted">{domain.label}</span>
      <RankBadge verifiedRank={domain.verifiedRank} claimedRank={domain.claimedRank} size="sm" />
    </li>
  );
}

export default async function OverviewPage() {
  const { ctx, actor } = await requireConsoleContext();
  const viewer = await loadViewer(ctx);
  const [metrics, audit, newest, profile] = await Promise.all([
    loadOverviewMetrics(ctx),
    can(ctx, 'canViewAuditLogs') ? listAuditLogs(ctx, { limit: RECENT_AUDIT_LIMIT }) : null,
    can(ctx, 'canViewMembers') ? listMembers(ctx, { limit: NEWEST_MEMBERS_LIMIT }) : null,
    actor.memberId ? getProfile(ctx, { memberId: actor.memberId }) : null,
  ]);
  const now = ctx.clock.now();

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="JAVELIN / STATUS"
        title="Overview"
        description="The state of the organization, live. Counts reflect only what your roles can see."
        meta={
          <>
            <Mono dim>
              {formatTimestamp(now, viewer.timeZone)} {viewer.timeZone}
            </Mono>
            {viewer.primaryRole ? <RoleBadge role={viewer.primaryRole} size="sm" /> : null}
          </>
        }
      />

      {metrics.length > 0 ? (
        <section
          aria-label="Organization metrics"
          className={cx(
            'grid grid-cols-2 gap-3 [&>:last-child:nth-child(odd)]:col-span-2 lg:[&>:last-child:nth-child(odd)]:col-span-1',
            METRIC_COLUMNS[metrics.length] ?? DEFAULT_METRIC_COLUMNS,
          )}
        >
          {metrics.map((metric) => {
            const copy = METRIC_COPY[metric.key];
            return (
              <Stat
                key={metric.key}
                label={copy.label}
                value={metric.value}
                hint={copy.hint}
                href={copy.href}
                linkComponent={NextLink}
              />
            );
          })}
        </section>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {audit ? (
          <Panel
            title="Recent activity"
            description="The latest audited actions across JAVE."
            actions={
              <Link
                href="/audit"
                className="inline-flex items-center gap-1 text-small text-fg-subtle hover:text-fg"
              >
                Audit log
                <Icon icon={ArrowUpRight} size="sm" />
              </Link>
            }
            flush
          >
            {audit.items.length === 0 ? (
              <EmptyState
                compact
                title="NO ACTIVITY YET"
                description="Audited actions will appear here."
              />
            ) : (
              <ul className="divide-y divide-line-subtle">
                {audit.items.map((entry) => (
                  <li
                    key={entry.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-5 py-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto_64px]"
                  >
                    <Mono className="truncate text-small text-fg">{entry.action}</Mono>
                    <span className="order-3 truncate text-small text-fg-subtle sm:order-none">
                      {entry.actorName ?? entry.actorType}
                    </span>
                    <span className="order-4 justify-self-end sm:order-none">
                      <AuditResultBadge result={entry.result} />
                    </span>
                    <Mono dim className="order-2 text-right text-[12px] sm:order-none">
                      {formatRelative(entry.createdAt, now, viewer.timeZone)}
                    </Mono>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : newest ? (
          <NewestMembers items={newest.items} />
        ) : null}

        <div className="space-y-6">
          <Panel
            title="Your capability"
            description="Peak facet rank per domain. Never a total."
            actions={
              <Link href="/me?tab=claims" className="text-small text-fg-subtle hover:text-fg">
                Claim
              </Link>
            }
          >
            {profile ? (
              <ul className="-my-2.5 divide-y divide-line-subtle">
                {profile.domains.map((domain) => (
                  <DomainRow key={domain.key} domain={domain} />
                ))}
              </ul>
            ) : (
              <p className="text-small text-fg-subtle">
                No JAVELIN profile is linked to this account.
              </p>
            )}
          </Panel>
          {audit && newest ? <NewestMembers items={newest.items} /> : null}
        </div>
      </div>
    </div>
  );
}

interface NewestMember {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string;
  primaryRole: Parameters<typeof RoleBadge>[0]['role'] | null;
}

function NewestMembers({ items }: { items: readonly NewestMember[] }) {
  return (
    <Panel
      title="Newest members"
      actions={
        <Link href="/members" className="text-small text-fg-subtle hover:text-fg">
          All members
        </Link>
      }
      flush
    >
      {items.length === 0 ? (
        <EmptyState
          compact
          title="NO MEMBERS YET"
          description="Members appear once they join or sign in."
        />
      ) : (
        <ul className="divide-y divide-line-subtle">
          {items.map((member) => (
            <li key={member.id}>
              <Link
                href={`/members/${member.id}`}
                className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-raised/60"
              >
                <Avatar name={member.displayName} src={member.avatarUrl} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-small text-fg">{member.displayName}</span>
                  <span className="type-data block truncate text-[11px] text-fg-subtle">
                    @{member.handle}
                  </span>
                </span>
                {member.primaryRole ? <RoleBadge role={member.primaryRole} size="sm" /> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
