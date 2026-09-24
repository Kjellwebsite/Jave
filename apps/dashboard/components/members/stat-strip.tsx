import type { ProfileStats } from '@jave/core';
import { cx, formatCount } from '@jave/ui';

const STAT_ORDER: readonly { key: keyof ProfileStats; label: string }[] = [
  { key: 'trials', label: 'TRIALS' },
  { key: 'trialsPassed', label: 'PASSED' },
  { key: 'projects', label: 'PROJECTS' },
  { key: 'projectsShipped', label: 'SHIPPED' },
  { key: 'contributions', label: 'CONTRIBUTIONS' },
  { key: 'missionsCompleted', label: 'MISSIONS' },
  { key: 'achievements', label: 'ACHIEVEMENTS' },
];

/**
 * Seven readouts never leave an orphan cell: phones use a six-column track
 * (3 + 2 + 2), tablets a twelve-column track (4 + 3), desktops one row.
 */
const PHONE_FIRST_ROW = 3;
const TABLET_FIRST_ROW = 4;

function cellSpan(index: number): string {
  return cx(
    index < PHONE_FIRST_ROW ? 'col-span-2' : 'col-span-3',
    index < TABLET_FIRST_ROW ? 'sm:col-span-3' : 'sm:col-span-4',
    'lg:col-span-1',
  );
}

/** Verified activity counts as an instrument strip. Only verified facts are counted. */
export function StatStrip({ stats, className }: { stats: ProfileStats; className?: string }) {
  return (
    <dl
      className={cx(
        'grid grid-cols-6 overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-12 lg:grid-cols-7',
        className,
      )}
    >
      {STAT_ORDER.map(({ key, label }, index) => (
        <div
          key={key}
          className={cx(
            '-mb-px -mr-px border-b border-r border-line-subtle px-4 py-4',
            cellSpan(index),
          )}
        >
          <dt className="type-eyebrow text-[10px] text-fg-subtle">{label}</dt>
          <dd
            className={cx(
              'mt-2 font-display text-[22px] font-medium leading-none tabular-nums',
              stats[key] === 0 ? 'text-fg-subtle' : 'text-fg',
            )}
          >
            {formatCount(stats[key])}
          </dd>
        </div>
      ))}
    </dl>
  );
}
