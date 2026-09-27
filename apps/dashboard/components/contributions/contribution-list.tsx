'use client';

import Link from 'next/link';
import { Check, ExternalLink, GitPullRequestArrow, X } from 'lucide-react';
import { Badge, Button, EmptyState, Icon, Mono, StatusBadge, Textarea } from '@jave/ui';
import {
  CONTRIBUTION_STATUS_LABELS,
  CONTRIBUTION_STATUS_TONE,
  type ContributionStatusKey,
  projectPath,
} from '@/lib/project-view';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';

export interface ContributionRow {
  id: string;
  title: string;
  kindLabel: string;
  status: ContributionStatusKey;
  /** `manual` (recorded by the author), `github`, `system` — where the record came from. */
  source: string;
  authorName: string;
  authorHandle: string;
  project: { slug: string; title: string } | null;
  /** Already checked to be http(s). */
  href: string | null;
  description: string | null;
  reviewNote: string | null;
  occurredLabel: string;
  /** The viewer may verify/reject it (core decides again on submit). */
  reviewable: boolean;
  /** The viewer is the author. */
  own: boolean;
}

export interface ContributionListProps {
  rows: readonly ContributionRow[];
  emptyTitle: string;
  emptyDescription: string;
  actions: { verify: FormAction; reject: FormAction };
  /** Hide the project column (inside a project page). */
  hideProject?: boolean;
}

const NOTE_MAX = 1000;
const REASON_MIN = 3;

function ReviewControls({
  row,
  actions,
}: {
  row: ContributionRow;
  actions: ContributionListProps['actions'];
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <ConfirmActionDialog
        eyebrow="REVIEW"
        title="Verify contribution"
        description={`“${row.title}” by ${row.authorName} becomes accepted evidence. The author is notified.`}
        confirmLabel="Verify"
        action={actions.verify}
        hidden={{ contributionId: row.id }}
        trigger={
          <Button size="sm" variant="secondary" iconLeft={Check} data-testid={`verify-${row.id}`}>
            Verify
          </Button>
        }
      >
        <FormField name="note" label="Note" description="Optional. The author sees it.">
          <Textarea name="note" rows={2} maxLength={NOTE_MAX} />
        </FormField>
      </ConfirmActionDialog>
      <ConfirmActionDialog
        eyebrow="REVIEW"
        title="Reject contribution"
        description={`“${row.title}” by ${row.authorName} is closed as rejected. The author reads your reason.`}
        confirmLabel="Reject"
        tone="danger"
        action={actions.reject}
        hidden={{ contributionId: row.id }}
        trigger={
          <Button size="sm" variant="ghost" iconLeft={X} data-testid={`reject-${row.id}`}>
            Reject
          </Button>
        }
      >
        <FormField name="reason" label="Reason" description="Required. Be specific." required>
          <Textarea name="reason" rows={3} required minLength={REASON_MIN} maxLength={NOTE_MAX} />
        </FormField>
      </ConfirmActionDialog>
    </div>
  );
}

/** Contributions with status, provenance and — for reviewers — VERIFY / REJECT. */
export function ContributionList({
  rows,
  emptyTitle,
  emptyDescription,
  actions,
  hideProject = false,
}: ContributionListProps) {
  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        icon={GitPullRequestArrow}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }
  return (
    <ul aria-label="Contributions" className="divide-y divide-line-subtle">
      {rows.map((row) => (
        <li
          key={row.id}
          data-contribution={row.title}
          className="grid gap-x-5 gap-y-3 px-4 py-4 sm:px-5 md:grid-cols-[minmax(0,1fr)_auto]"
        >
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                tone={CONTRIBUTION_STATUS_TONE[row.status]}
                quiet={row.status === 'verified'}
                label={CONTRIBUTION_STATUS_LABELS[row.status].toUpperCase()}
              />
              <Badge>{row.kindLabel}</Badge>
              {row.source !== 'manual' ? (
                <Badge tone="info">{row.source.toUpperCase()}</Badge>
              ) : null}
            </div>
            <p className="break-words text-body text-fg">
              {row.href ? (
                <a
                  href={row.href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-center gap-1.5 hover:underline"
                >
                  {row.title}
                  <Icon icon={ExternalLink} size="sm" className="text-fg-subtle" />
                </a>
              ) : (
                row.title
              )}
            </p>
            {row.description ? (
              <p className="line-clamp-3 whitespace-pre-line text-small text-fg-subtle">
                {row.description}
              </p>
            ) : null}
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-fg-subtle">
              <span>
                {row.authorName} <Mono dim>@{row.authorHandle}</Mono>
              </span>
              {!hideProject && row.project ? (
                <Link
                  href={projectPath(row.project.slug)}
                  className="text-fg-muted hover:underline"
                >
                  {row.project.title}
                </Link>
              ) : null}
              <Mono dim className="text-[12px]">
                {row.occurredLabel}
              </Mono>
            </p>
            {row.reviewNote ? (
              <p className="border-l border-line-strong pl-3 text-small text-fg-muted">
                {row.reviewNote}
              </p>
            ) : null}
          </div>
          {row.reviewable && row.status === 'submitted' ? (
            <ReviewControls row={row} actions={actions} />
          ) : row.own && row.status === 'submitted' ? (
            <p className="type-eyebrow self-start text-fg-subtle md:text-right">
              Yours · someone else reviews it
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
