import { Award, LockKeyhole } from 'lucide-react';
import type { achievements } from '@jave/core';
import { Badge, cx, EmptyState, Icon, Mono } from '@jave/ui';
import { RARITY_LABELS, RARITY_TONE } from '@/lib/achievement-labels';
import { formatDate } from '@/lib/time';

function Percent({ value }: { value: number | undefined }) {
  if (value === undefined) return null;
  return (
    <Mono dim className="text-[12px]" title="Share of active members holding it">
      {value === 0 ? 'nobody yet' : `${value}%`}
    </Mono>
  );
}

/**
 * The catalog as the viewer may see it: unlocked entries marked, hidden
 * entries masked until unlocked, rarity and share of active members.
 */
export function CatalogGrid({
  catalog,
  percents,
  timeZone,
}: {
  catalog: readonly achievements.CatalogEntry[];
  percents: ReadonlyMap<string, number> | null;
  timeZone: string;
}) {
  if (catalog.length === 0) {
    return (
      <EmptyState
        icon={Award}
        title="NO ACHIEVEMENTS DEFINED"
        description="Staff define achievements for verified outcomes. They appear here once active."
      />
    );
  }
  const unlocked = catalog.filter((entry) => entry.unlocked).length;
  return (
    <section aria-labelledby="catalog-heading" className="space-y-3">
      <h2 id="catalog-heading" className="type-eyebrow text-fg-subtle">
        CATALOG · {unlocked} OF {catalog.length} UNLOCKED
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {catalog.map((entry) =>
          entry.masked ? (
            <li
              key={`masked-${entry.slot}`}
              className="rounded-lg border border-dashed border-line bg-surface-sunken p-4"
            >
              <div className="flex items-start gap-3">
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-line text-fg-faint">
                  <Icon icon={LockKeyhole} />
                </span>
                <div className="min-w-0">
                  <p className="type-eyebrow text-fg-subtle">{entry.title}</p>
                  <p className="mt-1 text-small text-fg-subtle">{entry.summary}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Badge tone={RARITY_TONE[entry.rarity]}>{RARITY_LABELS[entry.rarity]}</Badge>
              </div>
            </li>
          ) : (
            <li
              key={entry.key}
              data-achievement={entry.key}
              className={cx(
                'relative rounded-lg border bg-surface p-4',
                entry.unlocked ? 'machined border-line-strong' : 'border-line',
              )}
            >
              <div className="flex items-start gap-3">
                <span
                  className={cx(
                    'inline-flex size-9 shrink-0 items-center justify-center rounded-md border',
                    entry.unlocked
                      ? 'chrome-plate border-transparent text-action-fg'
                      : 'border-line-strong bg-surface-raised text-fg-subtle',
                  )}
                >
                  <Icon icon={Award} />
                </span>
                <div className="min-w-0">
                  <p className={cx('type-eyebrow', entry.unlocked ? 'text-fg' : 'text-fg-muted')}>
                    {entry.title}
                  </p>
                  <p className="mt-1 text-small text-fg-subtle">{entry.summary}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone={RARITY_TONE[entry.rarity]}>{RARITY_LABELS[entry.rarity]}</Badge>
                {entry.unlocked ? (
                  <Badge tone={entry.verified ? 'success' : 'warning'}>
                    {entry.verified ? 'Unlocked' : 'Pending verification'}
                  </Badge>
                ) : null}
                {entry.visibility === 'hidden' ? <Badge>Hidden</Badge> : null}
                <span className="ml-auto flex items-center gap-2">
                  {entry.unlockedAt ? (
                    <Mono dim className="text-[12px]">
                      {formatDate(entry.unlockedAt, timeZone)}
                    </Mono>
                  ) : (
                    <Percent value={percents?.get(entry.key)} />
                  )}
                </span>
              </div>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
