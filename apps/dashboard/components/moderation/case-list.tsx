import Link from 'next/link';
import type { moderation } from '@jave/core';
import { Badge, cx, Mono, StatusBadge } from '@jave/ui';
import {
  CASE_ACTION_LABELS,
  CASE_ACTION_TONE,
  CASE_SOURCE_LABELS,
  caseState,
  SYNC_LABELS,
  SYNC_TONE,
} from '@/lib/moderation-labels';
import { formatTimestamp } from '@/lib/time';

const ROW_GRID =
  '@4xl:grid-cols-[104px_minmax(0,1fr)_128px_112px_112px_132px] @4xl:items-center @4xl:gap-x-4';
const HEADINGS = ['Case', 'Member · reason', 'Action', 'State', 'Discord', 'Recorded'];

export interface CaseListProps {
  cases: readonly moderation.ModCaseView[];
  timeZone: string;
  /** Hide the member name (the list is already one member's record). */
  hideMember?: boolean;
  label: string;
}

function moderatorName(view: moderation.ModCaseView): string {
  if (view.moderator) return view.moderator.name;
  return CASE_SOURCE_LABELS[view.source];
}

/** Case rows: reference, member and reason, action, state, Discord sync, time. */
export function CaseList({ cases, timeZone, hideMember = false, label }: CaseListProps) {
  // Container queries: the row layout follows the list's own width (a full-width tab
  // or a side column), not the viewport.
  return (
    <div className="@container">
      <div
        aria-hidden
        className={cx('hidden border-b border-line px-5 py-2.5 @4xl:grid', ROW_GRID)}
      >
        {HEADINGS.map((heading) => (
          <span key={heading} className="type-eyebrow text-fg-subtle">
            {heading === 'Member · reason' && hideMember ? 'Reason' : heading}
          </span>
        ))}
      </div>
      <ul aria-label={label} className="divide-y divide-line-subtle">
        {cases.map((view) => {
          const state = caseState(view);
          const syncNeedsEye = view.discordState === 'failed' || view.discordState === 'pending';
          return (
            <li key={view.id} data-case={view.reference}>
              <Link
                href={`/moderation/cases/${view.id}`}
                className={cx(
                  'grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 px-5 py-3.5 transition-colors hover:bg-surface-raised/60 focus-visible:bg-surface-raised/60',
                  ROW_GRID,
                )}
              >
                <Mono className="text-small text-fg">{view.reference}</Mono>
                <span className="justify-self-end @4xl:hidden">
                  <Badge tone={CASE_ACTION_TONE[view.action]}>
                    {CASE_ACTION_LABELS[view.action]}
                  </Badge>
                </span>
                <span className="col-span-2 min-w-0 @4xl:col-span-1">
                  {hideMember ? null : (
                    <span className="block truncate text-body text-fg">{view.target.name}</span>
                  )}
                  <span
                    className={cx(
                      'block truncate text-small',
                      hideMember ? 'text-fg-muted' : 'text-fg-subtle',
                    )}
                  >
                    {view.reason}
                  </span>
                  <span className="block truncate text-small text-fg-subtle @4xl:hidden">
                    by {moderatorName(view)}
                  </span>
                </span>
                <span className="hidden @4xl:block">
                  <Badge tone={CASE_ACTION_TONE[view.action]}>
                    {CASE_ACTION_LABELS[view.action]}
                  </Badge>
                </span>
                <span className="flex flex-wrap items-center gap-2 @4xl:block">
                  <StatusBadge tone={state.tone} quiet={state.quiet} label={state.label} />
                  {syncNeedsEye ? (
                    <StatusBadge
                      className="@4xl:hidden"
                      tone={SYNC_TONE[view.discordState]}
                      label={`Discord ${SYNC_LABELS[view.discordState]}`}
                    />
                  ) : null}
                </span>
                <span className="hidden @4xl:block">
                  <StatusBadge
                    tone={SYNC_TONE[view.discordState]}
                    quiet={!syncNeedsEye}
                    label={SYNC_LABELS[view.discordState]}
                  />
                </span>
                <Mono dim className="justify-self-end text-[12px] @4xl:justify-self-start">
                  {formatTimestamp(view.createdAt, timeZone)}
                </Mono>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
