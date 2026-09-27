import { ExternalLink, FileCheck2 } from 'lucide-react';
import type { verification } from '@jave/core';
import { Badge, EmptyState, Icon, Mono, StatusBadge } from '@jave/ui';
import { safeExternalUrl } from '@/lib/safe-url';
import { formatDate } from '@/lib/time';
import {
  VERIFICATION_STATUS_LABELS,
  VERIFICATION_STATUS_TONE,
  VERIFICATION_TYPE_LABELS,
} from '@/lib/verification';

export function VerificationStatusBadge({ status }: { status: verification.VerificationStatus }) {
  return (
    <StatusBadge
      tone={VERIFICATION_STATUS_TONE[status]}
      label={VERIFICATION_STATUS_LABELS[status].toUpperCase()}
      live={status === 'in_review'}
    />
  );
}

export function VerificationTypeBadge({ type }: { type: verification.VerificationType }) {
  return <Badge>{VERIFICATION_TYPE_LABELS[type]}</Badge>;
}

const EVIDENCE_TONE = { submitted: 'neutral', accepted: 'success', rejected: 'danger' } as const;

function evidenceTone(status: string) {
  return status === 'accepted' || status === 'rejected' ? EVIDENCE_TONE[status] : 'neutral';
}

/** Evidence cited by one verification, as rows inside a flush panel. Links are http(s) only. */
export function VerificationEvidence({
  items,
  timeZone,
}: {
  items: readonly verification.VerificationEvidenceItem[];
  timeZone: string;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        compact
        icon={FileCheck2}
        title="NO EVIDENCE"
        description="The claim stands on its own. Verifiers may ask for more."
      />
    );
  }
  return (
    <ul className="divide-y divide-line-subtle">
      {items.map((item) => {
        const href = safeExternalUrl(item.url);
        return (
          <li key={item.id} className="min-w-0 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex min-w-0 items-center gap-1.5 text-body font-medium text-fg underline-offset-4 hover:underline"
                >
                  <span className="break-words">{item.title}</span>
                  <Icon icon={ExternalLink} size="sm" className="shrink-0 text-fg-subtle" />
                </a>
              ) : (
                <span className="text-body font-medium text-fg">{item.title}</span>
              )}
              <Badge tone={evidenceTone(item.status)}>{item.status.toUpperCase()}</Badge>
            </div>
            {item.url ? (
              <Mono dim className="mt-1 block truncate text-[12px]">
                {item.url}
              </Mono>
            ) : null}
            {item.description ? (
              <p className="mt-1.5 whitespace-pre-wrap break-words text-small text-fg-muted">
                {item.description}
              </p>
            ) : null}
            <Mono dim className="mt-1.5 block text-[12px]">
              {formatDate(item.createdAt, timeZone)}
            </Mono>
          </li>
        );
      })}
    </ul>
  );
}
