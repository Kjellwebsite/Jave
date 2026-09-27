import 'server-only';
import type { projects } from '@jave/core';
import type { ContributionRow } from '@/components/contributions/contribution-list';
import { CONTRIBUTION_KIND_LABELS } from '@/lib/project-view';
import { safeExternalUrl } from '@/lib/safe-url';
import { formatDate } from '@/lib/time';

/**
 * Service views → serializable rows for client components. `reviewable` is a
 * UI hint only: core decides again when the reviewer submits.
 *
 * listContributions shows a non-reviewer another member's SUBMITTED
 * contribution only when they manage its project, so "submitted and not
 * mine" is exactly "the viewer may review it".
 */
export function contributionRows(
  items: readonly projects.ContributionView[],
  viewerMemberId: string | null,
  timeZone: string,
): ContributionRow[] {
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    kindLabel: CONTRIBUTION_KIND_LABELS[item.kind],
    status: item.status,
    source: item.source,
    authorName: item.memberDisplayName,
    authorHandle: item.memberHandle,
    project:
      item.projectSlug && item.projectTitle
        ? { slug: item.projectSlug, title: item.projectTitle }
        : null,
    href: safeExternalUrl(item.url),
    description: item.description,
    reviewNote: item.reviewNote,
    occurredLabel: formatDate(item.occurredAt, timeZone),
    reviewable: item.status === 'submitted' && item.memberId !== viewerMemberId,
    own: item.memberId === viewerMemberId,
  }));
}

/** Host of an http(s) URL for display, or the raw text when it does not parse. */
export function urlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
