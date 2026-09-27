import { ExternalLink, Inbox } from 'lucide-react';
import { can, missions, type ServiceContext } from '@jave/core';
import { Badge, Card, EmptyState, Icon, Mono, RestrictedState } from '@jave/ui';
import { safeExternalUrl } from '@/lib/safe-url';
import { formatTimestamp } from '@/lib/time';
import type { FormAction } from '../forms/action-form';
import { ReviewActions } from './review-actions';

/** Units fetched per page of the global queue (the service's page cap). */
const QUEUE_PAGE = 100;
/** Stop scanning after this many units; the service itself scans at most 500 submissions. */
const QUEUE_SCAN_MAX = 500;

function unitLabel(item: missions.ReviewQueueItem): string {
  if (!item.teamKey) return item.members[0]?.displayName ?? 'Member';
  return `Team ${item.teamKey} (${item.members.length} member${item.members.length === 1 ? '' : 's'})`;
}

/**
 * Submissions of one mission awaiting review, oldest first, one entry per
 * unit (a team reviews as one). The reviewer's own units show no controls;
 * the service refuses them anyway.
 */
export async function ReviewQueue({
  ctx,
  missionId,
  timeZone,
  verifyAction,
  rejectAction,
}: {
  ctx: ServiceContext;
  missionId: string;
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
  const items: missions.ReviewQueueItem[] = [];
  for (let offset = 0; offset < QUEUE_SCAN_MAX; offset += QUEUE_PAGE) {
    const page = await missions.listSubmissionsForReview(ctx, { limit: QUEUE_PAGE, offset });
    items.push(...page.items.filter((item) => item.missionId === missionId));
    if (offset + QUEUE_PAGE >= page.total) break;
  }
  if (items.length === 0) {
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
    <ul className="space-y-3" aria-label="Submissions awaiting review">
      {items.map((item) => {
        const evidenceUrl = safeExternalUrl(item.evidenceUrl);
        return (
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
              {item.evidenceTitle || evidenceUrl ? (
                <p className="flex flex-wrap items-center gap-2 text-small">
                  <span className="type-eyebrow text-fg-subtle">EVIDENCE</span>
                  {evidenceUrl ? (
                    <a
                      href={evidenceUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex min-w-0 items-center gap-1 break-all text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg"
                    >
                      {item.evidenceTitle ?? new URL(evidenceUrl).host}
                      <Icon icon={ExternalLink} size="sm" />
                    </a>
                  ) : (
                    <span className="text-fg-muted">{item.evidenceTitle}</span>
                  )}
                  {evidenceUrl ? (
                    <Mono dim className="text-[12px]">
                      {new URL(evidenceUrl).host}
                    </Mono>
                  ) : null}
                </p>
              ) : null}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
