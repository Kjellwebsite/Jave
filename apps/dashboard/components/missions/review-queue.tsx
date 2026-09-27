import { ExternalLink, Inbox } from 'lucide-react';
import { can, missions, type ServiceContext } from '@jave/core';
import { Badge, Card, EmptyState, Icon, Mono, Pagination, RestrictedState } from '@jave/ui';
import { safeExternalUrl } from '@/lib/safe-url';
import { toQueryString } from '@/lib/search-params';
import { formatTimestamp } from '@/lib/time';
import type { FormAction } from '../forms/action-form';
import { NextLink } from '../next-link';
import { ReviewActions } from './review-actions';

/** Units per page of one mission's queue. */
export const REVIEW_PAGE_SIZE = 20;

function unitLabel(item: missions.ReviewQueueItem): string {
  if (!item.teamKey) return item.members[0]?.displayName ?? 'Member';
  return `Team ${item.teamKey} (${item.members.length} member${item.members.length === 1 ? '' : 's'})`;
}

function Evidence({ item }: { item: missions.ReviewQueueItem }) {
  const url = safeExternalUrl(item.evidenceUrl);
  if (!item.evidenceTitle && !url) return null;
  const host = url ? new URL(url).host : null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-small">
      <span className="type-eyebrow text-fg-subtle">EVIDENCE</span>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex min-w-0 items-center gap-1 break-all text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg"
        >
          {item.evidenceTitle ?? host}
          <Icon icon={ExternalLink} size="sm" />
        </a>
      ) : (
        <span className="text-fg-muted">{item.evidenceTitle}</span>
      )}
      {host ? (
        <Mono dim className="text-[12px]">
          {host}
        </Mono>
      ) : null}
    </p>
  );
}

/**
 * One mission's submissions awaiting review, oldest first, one entry per unit
 * (a team reviews as one). The reviewer's own units show no controls; the
 * service refuses them anyway.
 */
export async function ReviewQueue({
  ctx,
  missionId,
  offset,
  timeZone,
  verifyAction,
  rejectAction,
}: {
  ctx: ServiceContext;
  missionId: string;
  offset: number;
  timeZone: string;
  verifyAction: FormAction;
  rejectAction: FormAction;
}) {
  if (!can(ctx, 'canVerifyMissions')) {
    return (
      <Card padding="none">
        <RestrictedState requirement="canVerifyMissions" />
      </Card>
    );
  }
  const page = await missions.listSubmissionsForReview(ctx, {
    missionId,
    limit: REVIEW_PAGE_SIZE,
    offset,
  });
  if (page.items.length === 0) {
    return (
      <Card padding="none">
        <EmptyState
          icon={Inbox}
          title="QUEUE CLEAR"
          description="No submission for this mission awaits review."
        />
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <ul className="space-y-3" aria-label="Submissions awaiting review">
        {page.items.map((item) => (
          <li key={item.assignmentId}>
            <Card className="space-y-4" data-review-unit={item.assignmentId}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="type-heading text-fg">{unitLabel(item)}</p>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-fg-subtle">
                    {item.teamKey ? (
                      <span>{item.members.map((member) => member.displayName).join(', ')}</span>
                    ) : (
                      <Mono dim className="text-[12px]">
                        @{item.members[0]?.handle}
                      </Mono>
                    )}
                    <Mono dim className="text-[12px]">
                      {item.submittedAt ? formatTimestamp(item.submittedAt, timeZone) : '—'}
                    </Mono>
                    <span>
                      Attempt {item.attempts} of {missions.MAX_SUBMISSION_ATTEMPTS}
                    </span>
                  </p>
                </div>
                {item.isOwn ? (
                  <Badge tone="info">Your unit — another reviewer decides it</Badge>
                ) : (
                  <ReviewActions
                    assignmentId={item.assignmentId}
                    unitLabel={unitLabel(item)}
                    verifyAction={verifyAction}
                    rejectAction={rejectAction}
                  />
                )}
              </div>
              <p className="whitespace-pre-wrap break-words rounded-md border border-line-subtle bg-surface-sunken p-3 text-body text-fg-muted">
                {item.submission ?? 'No text submitted.'}
              </p>
              <Evidence item={item} />
            </Card>
          </li>
        ))}
      </ul>
      {page.total > page.limit ? (
        <Pagination
          offset={page.offset}
          limit={page.limit}
          total={page.total}
          linkComponent={NextLink}
          hrefForOffset={(next) =>
            `/missions/${missionId}${toQueryString({ tab: 'review', offset: next || undefined })}`
          }
        />
      ) : null}
    </div>
  );
}
