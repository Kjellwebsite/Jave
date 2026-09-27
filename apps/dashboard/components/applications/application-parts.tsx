import Link from 'next/link';
import { ExternalLink, History, MessageSquareText } from 'lucide-react';
import type { applications } from '@jave/core';
import {
  Badge,
  EmptyState,
  Icon,
  Mono,
  StatusBadge,
  Timeline,
  type TimelineItem,
  type TimelineTone,
} from '@jave/ui';
import {
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_TONE,
  RECOMMENDATION_LABELS,
  RECOMMENDATION_TONE,
} from '@/lib/applications';
import { safeExternalUrl } from '@/lib/safe-url';
import { formatTimestamp } from '@/lib/time';

type ApplicationStatus = applications.ApplicationStatus;
type PersonRef = applications.PersonRef;

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <StatusBadge
      tone={APPLICATION_STATUS_TONE[status]}
      label={APPLICATION_STATUS_LABELS[status].toUpperCase()}
      live={status === 'interview'}
    />
  );
}

/** A person, linked to their member page when the viewer may open it. */
export function PersonName({ person, link }: { person: PersonRef | null; link: boolean }) {
  if (!person) return <span className="text-fg-subtle">—</span>;
  const name = <span className="font-medium text-fg">{person.displayName}</span>;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-2">
      {link && person.memberId ? (
        <Link href={`/members/${person.memberId}`} className="underline-offset-4 hover:underline">
          {name}
        </Link>
      ) : (
        name
      )}
      {person.handle ? (
        <Mono dim className="text-[12px]">
          @{person.handle}
        </Mono>
      ) : null}
    </span>
  );
}

/** One long answer. User text is rendered as text (React escapes it), whitespace kept. */
export function Answer({ label, text }: { label: string; text: string | null }) {
  return (
    <section className="space-y-2">
      <h3 className="type-eyebrow text-fg-subtle">{label}</h3>
      {text ? (
        <p className="whitespace-pre-wrap break-words text-body leading-relaxed text-fg-muted">
          {text}
        </p>
      ) : (
        <p className="text-small text-fg-subtle">Not answered.</p>
      )}
    </section>
  );
}

/** External links as plain, safe anchors: http(s) only, no referrer, never followed by crawlers. */
export function LinkList({ links, empty }: { links: readonly string[]; empty: string }) {
  if (links.length === 0) return <p className="text-small text-fg-subtle">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {links.map((link) => {
        const href = safeExternalUrl(link);
        return (
          <li key={link} className="min-w-0">
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex max-w-full items-center gap-1.5 text-body text-fg underline-offset-4 hover:underline"
              >
                <span className="truncate">{link}</span>
                <Icon icon={ExternalLink} size="sm" className="shrink-0 text-fg-subtle" />
              </a>
            ) : (
              <Mono className="break-all">{link}</Mono>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ReviewList({
  reviews,
  timeZone,
  viewerUserId,
}: {
  reviews: readonly applications.StaffReviewView[];
  timeZone: string;
  viewerUserId: string;
}) {
  if (reviews.length === 0) {
    return (
      <EmptyState
        compact
        icon={MessageSquareText}
        title="NO REVIEWS YET"
        description="Reviews appear here as reviewers record them."
      />
    );
  }
  return (
    <ul className="divide-y divide-line-subtle">
      {reviews.map((review) => (
        <li key={review.reviewerUserId} className="space-y-2 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={RECOMMENDATION_TONE[review.recommendation]}>
              {RECOMMENDATION_LABELS[review.recommendation]}
            </Badge>
            {review.score !== null ? <Mono className="text-fg">{review.score}/5</Mono> : null}
            {review.reviewerUserId === viewerUserId ? <Badge>YOU</Badge> : null}
          </div>
          <p className="flex flex-wrap items-baseline gap-x-2 text-small text-fg-subtle">
            <PersonName person={review.reviewer} link={false} />
            <Mono dim className="text-[12px]">
              {formatTimestamp(review.updatedAt, timeZone)}
            </Mono>
          </p>
          {review.note ? (
            <p className="whitespace-pre-wrap break-words text-small text-fg-muted">
              {review.note}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

const STATUS_TIMELINE_TONE: Readonly<Record<ApplicationStatus, TimelineTone>> = {
  draft: 'neutral',
  submitted: 'info',
  review: 'info',
  interview: 'warning',
  accepted: 'success',
  rejected: 'danger',
  withdrawn: 'neutral',
};

export interface TimelineEntry {
  to: ApplicationStatus;
  from: ApplicationStatus | null;
  at: Date;
  /** Who made the change (staff views only). */
  actor?: string | null;
  /** The change's note (staff views only). */
  note?: string | null;
}

function timelineMeta(entry: TimelineEntry): string | undefined {
  const parts = [
    entry.from ? `from ${APPLICATION_STATUS_LABELS[entry.from].toLowerCase()}` : null,
    entry.actor ?? null,
    entry.note ?? null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** Status history, newest first. Text only: notes and names are never rendered as HTML. */
export function StatusTimeline({
  entries,
  timeZone,
}: {
  entries: readonly TimelineEntry[];
  timeZone: string;
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        compact
        icon={History}
        title="NO HISTORY"
        description="Status changes appear here."
      />
    );
  }
  const items: TimelineItem[] = [...entries].reverse().map((entry, index) => ({
    id: `${entry.at.toISOString()}-${index}`,
    at: entry.at,
    atLabel: formatTimestamp(entry.at, timeZone),
    tone: STATUS_TIMELINE_TONE[entry.to],
    title: <span className="type-eyebrow text-fg">{APPLICATION_STATUS_LABELS[entry.to]}</span>,
    meta: timelineMeta(entry),
  }));
  return <Timeline items={items} label="Status history" />;
}
