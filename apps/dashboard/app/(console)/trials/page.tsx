import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus, Swords } from 'lucide-react';
import { z } from 'zod';
import { can, trials } from '@jave/core';
import {
  buttonStyles,
  Card,
  EmptyState,
  Icon,
  LinkTabs,
  Mono,
  PageHeader,
  Pagination,
  Stat,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@jave/ui';
import { NextLink } from '@/components/next-link';
import { RestrictedPage } from '@/components/restricted-page';
import { TrialClock } from '@/components/trials/trial-clock';
import { TrialStatusBadge } from '@/components/trials/trial-status-badge';
import { firstParam, offsetParam, type SearchParams, toQueryString } from '@/lib/search-params';
import { categoryLabel, TRIAL_STATUS_LABELS } from '@/lib/trial-labels';
import { requireConsoleContext } from '@/server/context';
import { isTrialStaff, trialStatusCounts } from '@/server/data/trials';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';

export const metadata: Metadata = { title: 'Trials' };

const PAGE_SIZE = 25;
const COLUMNS = 4;

/** Filter tabs, most operational first. */
const FILTERS = [
  'active',
  'recruiting',
  'teams_assigned',
  'evaluating',
  'draft',
  'completed',
  'cancelled',
] as const satisfies readonly trials.TrialStatus[];

const READOUTS = [
  { status: 'active', label: 'LIVE', hint: 'Clock running' },
  { status: 'recruiting', label: 'RECRUITING', hint: 'Accepting applications' },
  { status: 'evaluating', label: 'EVALUATING', hint: 'Awaiting scores and results' },
  { status: 'draft', label: 'DRAFTS', hint: 'Not yet announced' },
] as const;

const filterSchema = z.object({
  status: z.enum(trials.TRIAL_STATUSES).optional().catch(undefined),
});

export default async function TrialsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireConsoleContext();
  if (!isTrialStaff(ctx))
    return <RestrictedPage eyebrow="OPERATIONS" title="Trials" capability="canManageTrials" />;
  const params = await searchParams;
  const { status } = filterSchema.parse({ status: firstParam(params.status) || undefined });
  const offset = offsetParam(params.offset);
  const result = await guarded(() =>
    trials.listTrials(ctx, { status, limit: PAGE_SIZE, offset }),
  );
  if (!result.ok)
    return <RestrictedPage eyebrow="OPERATIONS" title="Trials" capability="canManageTrials" />;
  const page = result.value;
  const [viewer, counts] = await Promise.all([loadViewer(ctx), trialStatusCounts(ctx)]);
  const manage = can(ctx, 'canManageTrials');
  const now = ctx.clock.now();
  const total = counts ? Object.values(counts).reduce((sum, value) => sum + value, 0) : page.total;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="OPERATIONS"
        title="Trials"
        description="Real missions, published rubrics, verified outcomes. Claimed capability becomes verified here."
        meta={<Mono dim>{total.toLocaleString('en-US')} total</Mono>}
        actions={
          manage ? (
            <>
              <Link href="/trials/templates" className={buttonStyles({ variant: 'secondary' })}>
                Templates
              </Link>
              <Link href="/trials/new" className={buttonStyles({ variant: 'primary' })}>
                <Icon icon={Plus} size="sm" />
                New trial
              </Link>
            </>
          ) : null
        }
      />

      {counts ? (
        <section aria-label="Trial readouts" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {READOUTS.map((readout) => (
            <Stat
              key={readout.status}
              label={readout.label}
              value={counts[readout.status]}
              hint={readout.hint}
              href={`/trials?status=${readout.status}`}
              linkComponent={NextLink}
            />
          ))}
        </section>
      ) : null}

      <Card padding="none">
        <LinkTabs
          label="Trial states"
          linkComponent={NextLink}
          className="px-3"
          tabs={[
            {
              href: '/trials',
              label: 'All',
              active: status === undefined,
              meta: <Mono dim>{total}</Mono>,
            },
            ...FILTERS.map((filter) => ({
              href: `/trials?status=${filter}`,
              label: TRIAL_STATUS_LABELS[filter],
              active: status === filter,
              meta: counts ? <Mono dim>{counts[filter]}</Mono> : undefined,
            })),
          ]}
        />

        {total === 0 ? (
          <EmptyState
            icon={Swords}
            title="NO TRIALS YET"
            description="Start from a template or write a custom mission. It stays a draft until you open recruitment."
            action={
              manage ? (
                <Link href="/trials/new" className={buttonStyles({ variant: 'primary' })}>
                  New trial
                </Link>
              ) : undefined
            }
          />
        ) : (
          <Table caption="Trials">
            <TableHead>
              <tr>
                <TableHeaderCell>Trial</TableHeaderCell>
                <TableHeaderCell className="hidden sm:table-cell">State</TableHeaderCell>
                <TableHeaderCell className="hidden md:table-cell">Format</TableHeaderCell>
                <TableHeaderCell className="text-right">Clock</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {page.items.length === 0 ? (
                <TableEmptyRow
                  colSpan={COLUMNS}
                  title="NONE IN THIS STATE"
                  description="No trial is in this state right now."
                  action={
                    <Link href="/trials" className={buttonStyles({ size: 'sm' })}>
                      Show all
                    </Link>
                  }
                />
              ) : (
                page.items.map((trial) => (
                  <TableRow key={trial.id} className="relative" data-trial={trial.ref}>
                    <TableCell>
                      <Link
                        href={`/trials/${trial.id}`}
                        className="block min-w-0 after:absolute after:inset-0 focus-visible:outline-none"
                      >
                        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <Mono dim className="text-[12px]">
                            {trial.ref}
                          </Mono>
                          <span className="text-body font-medium text-fg">{trial.title}</span>
                        </span>
                        <span className="mt-1 block text-small text-fg-subtle">
                          {categoryLabel(trial.category)}
                          <span className="md:hidden">
                            {' · '}teams of {trial.teamSize} ·{' '}
                            {trials.formatDuration(trial.durationMinutes)}
                          </span>
                        </span>
                        <span className="mt-2 block sm:hidden">
                          <TrialStatusBadge status={trial.status} />
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <TrialStatusBadge status={trial.status} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Mono dim>
                        {trial.teamSize}/team · {trials.formatDuration(trial.durationMinutes)}
                      </Mono>
                    </TableCell>
                    <TableCell className="text-right">
                      <TrialClock trial={trial} now={now} timeZone={viewer.timeZone} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}

        {page.total > 0 ? (
          <div className="border-t border-line-subtle px-5 py-3">
            <Pagination
              offset={page.offset}
              limit={page.limit}
              total={page.total}
              linkComponent={NextLink}
              hrefForOffset={(next) =>
                `/trials${toQueryString({ status, offset: next || undefined })}`
              }
            />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
