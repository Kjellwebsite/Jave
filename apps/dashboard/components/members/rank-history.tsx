import { History } from 'lucide-react';
import { Badge, EmptyState, RankBadge, Timeline, type TimelineItem } from '@jave/ui';
import { formatTimestamp } from '@/lib/time';

export interface RankHistoryEntry {
  id: string;
  facetKey: string;
  track: 'claimed' | 'verified';
  fromRank: string | null;
  toRank: string | null;
  source: string;
  reason: string | null;
  actorName: string | null;
  createdAt: Date;
}

const SOURCE_LABELS: Record<string, string> = {
  self: 'Self-reported',
  evaluator: 'Evaluator',
  trial: 'Trial',
  verification: 'Verification',
  system: 'System',
  import: 'Import',
};

function plate(track: RankHistoryEntry['track'], rank: string | null) {
  return track === 'verified' ? (
    <RankBadge verifiedRank={rank} size="xs" label="none" />
  ) : (
    <RankBadge claimedRank={rank} size="xs" label="none" />
  );
}

export function RankHistory({
  entries,
  facetLabels,
  timeZone,
}: {
  entries: readonly RankHistoryEntry[];
  facetLabels: Readonly<Record<string, string>>;
  timeZone: string;
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="NO RANK CHANGES"
        description="Claims and verifications will be recorded here."
      />
    );
  }
  const items: TimelineItem[] = entries.map((entry) => ({
    id: entry.id,
    at: entry.createdAt,
    atLabel: formatTimestamp(entry.createdAt, timeZone),
    tone: entry.track === 'verified' ? (entry.toRank ? 'success' : 'warning') : 'neutral',
    title: (
      <span className="flex flex-wrap items-center gap-2.5">
        <span className="font-medium">{facetLabels[entry.facetKey] ?? entry.facetKey}</span>
        <Badge tone={entry.track === 'verified' ? 'success' : 'neutral'}>
          {entry.track.toUpperCase()}
        </Badge>
        <span
          className="inline-flex items-center gap-1.5"
          aria-label={`from ${entry.fromRank ?? 'none'} to ${entry.toRank ?? 'none'}`}
        >
          {plate(entry.track, entry.fromRank)}
          <span aria-hidden className="text-fg-faint">
            →
          </span>
          {plate(entry.track, entry.toRank)}
        </span>
      </span>
    ),
    description: entry.reason ?? undefined,
    meta: `${SOURCE_LABELS[entry.source] ?? entry.source}${entry.actorName ? ` · ${entry.actorName}` : ''}`,
  }));
  return <Timeline items={items} label="Rank history" />;
}
