import { ExternalLink, FileCheck2 } from 'lucide-react';
import { Badge, EmptyState, Icon, Mono } from '@jave/ui';
import { safeExternalUrl } from '@/lib/safe-url';
import { formatDate } from '@/lib/time';

export interface EvidenceEntry {
  id: string;
  kind: string;
  title: string;
  url: string | null;
  description: string | null;
  facetKey: string | null;
  status: 'submitted' | 'accepted' | 'rejected';
  createdAt: Date;
}

const STATUS_TONE = { submitted: 'neutral', accepted: 'success', rejected: 'danger' } as const;

export function EvidenceList({
  items,
  facetLabels,
  timeZone,
}: {
  items: readonly EvidenceEntry[];
  facetLabels: Readonly<Record<string, string>>;
  timeZone: string;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={FileCheck2}
        title="NO EVIDENCE"
        description="Evidence attached to claims and verifications appears here."
      />
    );
  }
  return (
    <ul className="divide-y divide-line-subtle rounded-lg border border-line bg-surface">
      {items.map((item) => {
        const href = safeExternalUrl(item.url);
        return (
          <li key={item.id} className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-center gap-1.5 text-body font-medium text-fg underline-offset-4 hover:underline"
                >
                  {item.title}
                  <Icon icon={ExternalLink} size="sm" className="text-fg-subtle" />
                </a>
              ) : (
                <span className="text-body font-medium text-fg">{item.title}</span>
              )}
              <Badge>{item.kind.toUpperCase()}</Badge>
              <Badge tone={STATUS_TONE[item.status]}>{item.status.toUpperCase()}</Badge>
            </div>
            {item.description ? (
              <p className="mt-1.5 text-small text-fg-muted">{item.description}</p>
            ) : null}
            <p className="mt-1.5 flex flex-wrap gap-x-3 text-small text-fg-subtle">
              {item.facetKey ? <span>{facetLabels[item.facetKey] ?? item.facetKey}</span> : null}
              <Mono dim className="text-[12px]">
                {formatDate(item.createdAt, timeZone)}
              </Mono>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
