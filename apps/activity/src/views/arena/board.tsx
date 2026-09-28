import { Trophy } from 'lucide-react';
import { cx, EmptyState, formatCount, Panel, Skeleton } from '@jave/ui';
import type { ArenaBoardEntryWire } from '../../api/contract';
import type { ArenaBoardState } from '../../hooks/use-arena-board';

const RANK_DIGITS = 2;
const SKELETON_ROWS = 4;
/** The top three read brighter, as on the dashboard's games board. */
const PODIUM_RANKS = 3;

const COLUMNS = 'grid grid-cols-[1.75rem_minmax(0,1fr)_2.75rem_3.5rem] items-center gap-3 px-5';

function Row({ entry }: { entry: ArenaBoardEntryWire }) {
  return (
    <li className={cx(COLUMNS, 'py-2.5', entry.isYou && 'bg-surface-raised')}>
      <span
        className={cx(
          'type-data text-small',
          entry.rank <= PODIUM_RANKS ? 'text-fg' : 'text-fg-subtle',
        )}
      >
        {String(entry.rank).padStart(RANK_DIGITS, '0')}
      </span>
      <span className="min-w-0 truncate text-body text-fg">
        {entry.displayName}
        {entry.isYou ? <span className="type-eyebrow ml-2 text-fg-subtle">YOU</span> : null}
      </span>
      <span className="type-data text-right text-body text-fg tabular-nums">
        {formatCount(entry.wins)}
        <span className="sr-only"> wins</span>
      </span>
      <span className="type-data text-right text-small text-fg-muted tabular-nums">
        <span className="sr-only">best score </span>
        {formatCount(entry.bestScore)}
      </span>
    </li>
  );
}

function Body({ state }: { state: ArenaBoardState }) {
  const { data, error } = state;
  if (!data) {
    if (error) {
      return (
        <EmptyState
          compact
          icon={Trophy}
          title="BOARD UNAVAILABLE"
          description={
            error.transient ? 'The board could not be loaded. Retrying shortly.' : error.message
          }
          className="py-8!"
        />
      );
    }
    return (
      <div role="status" aria-live="polite" className="space-y-3 p-5">
        <span className="sr-only">Loading the board</span>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <Skeleton key={index} className="h-5 w-full" />
        ))}
      </div>
    );
  }
  if (data.entries.length === 0) {
    return (
      <EmptyState
        compact
        icon={Trophy}
        title="NO RANKED RESULTS YET"
        description="Games with two or more players count. Solo runs are practice."
        className="py-8!"
      />
    );
  }
  return (
    <>
      <div
        aria-hidden
        className={cx(COLUMNS, 'type-eyebrow border-b border-line-subtle py-2 text-fg-faint')}
      >
        <span>#</span>
        <span>MEMBER</span>
        <span className="text-right">WINS</span>
        <span className="text-right">BEST</span>
      </div>
      <ol aria-label="Trivia leaderboard by wins" className="divide-y divide-line-subtle">
        {data.entries.map((entry, index) => (
          <Row key={`${entry.rank}-${index}`} entry={entry} />
        ))}
      </ol>
    </>
  );
}

/**
 * The all-time trivia board, exactly as core shows it to this viewer: ranked
 * games only, and never a member who opted out or whose profile the viewer
 * could not open. Wins are game results, never capability.
 */
export function ArenaBoard({ state }: { state: ArenaBoardState }) {
  return (
    <Panel title="Leaderboard" eyebrow="TRIVIA · ALL TIME" flush data-testid="arena-board">
      <Body state={state} />
      <p className="border-t border-line-subtle px-5 py-3 text-[12px] leading-snug text-fg-subtle">
        Ranked games only. Opted-out members and profiles you cannot open are not listed.
      </p>
    </Panel>
  );
}
