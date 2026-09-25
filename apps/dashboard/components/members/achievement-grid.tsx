import { Award } from 'lucide-react';
import type { ProfileAchievement } from '@jave/core';
import { Badge, EmptyState, Icon, Mono } from '@jave/ui';
import { formatDate } from '@/lib/time';

export function AchievementGrid({
  achievements,
  timeZone,
}: {
  achievements: readonly ProfileAchievement[];
  timeZone: string;
}) {
  if (achievements.length === 0) {
    return (
      <EmptyState
        icon={Award}
        title="NO ACHIEVEMENTS YET"
        description="Achievements are earned through verified work — never activity."
      />
    );
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {achievements.map((achievement) => (
        <li
          key={achievement.key}
          className="machined relative rounded-lg border border-line bg-surface p-4"
        >
          <div className="flex items-start gap-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-line-strong bg-surface-raised text-fg-muted">
              <Icon icon={Award} />
            </span>
            <div className="min-w-0">
              <p className="type-eyebrow text-fg">{achievement.title}</p>
              <p className="mt-1 text-small text-fg-subtle">{achievement.description}</p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Badge>{achievement.rarity.toUpperCase()}</Badge>
            {achievement.verified ? <Badge tone="success">VERIFIED</Badge> : null}
            <Mono dim className="ml-auto text-[12px]">
              {formatDate(achievement.awardedAt, timeZone)}
            </Mono>
          </div>
        </li>
      ))}
    </ul>
  );
}
