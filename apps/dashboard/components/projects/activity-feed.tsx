import { Activity } from 'lucide-react';
import { EmptyState, Timeline, type TimelineItem } from '@jave/ui';
import { describeActivity, type ActivityInput } from '@/lib/project-view';

export interface ActivityEntry extends ActivityInput {
  id: number;
  occurredAt: Date;
  /** Pre-formatted in the viewer's time zone. */
  atLabel: string;
}

/** The project's domain events as one calm line each, newest first. */
export function ActivityFeed({ entries }: { entries: readonly ActivityEntry[] }) {
  if (entries.length === 0) {
    return (
      <EmptyState
        compact
        icon={Activity}
        title="NO ACTIVITY YET"
        description="Status changes, team changes, milestones and GitHub activity appear here."
      />
    );
  }
  const items: TimelineItem[] = entries.map((entry) => {
    const line = describeActivity(entry);
    return {
      id: String(entry.id),
      title: line.title,
      at: entry.occurredAt,
      atLabel: entry.atLabel,
      description: line.detail ?? undefined,
      meta: entry.actor ? `by ${entry.actor.displayName}` : undefined,
      tone: line.tone,
    };
  });
  return <Timeline items={items} label="Project activity" />;
}
