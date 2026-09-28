import { Check, Minus, X } from 'lucide-react';
import { cx, formatCount, Icon, Panel } from '@jave/ui';
import type { TriviaScoreWire, TriviaViewWire } from '../../api/contract';

const PLACE_DIGITS = 2;

function RoundMark({ entry, phase }: { entry: TriviaScoreWire; phase: TriviaViewWire['phase'] }) {
  if (phase === 'question') {
    return entry.answered ? (
      <span className="type-eyebrow text-fg-muted">LOCKED</span>
    ) : (
      <span className="type-eyebrow text-fg-faint">…</span>
    );
  }
  if (entry.correct === true) {
    return <Icon icon={Check} size="sm" label="Correct" className="text-success" />;
  }
  if (entry.correct === false) {
    return <Icon icon={X} size="sm" label="Incorrect" className="text-danger" />;
  }
  return <Icon icon={Minus} size="sm" label="No answer" className="text-fg-faint" />;
}

/**
 * Live standings. Points join the board at each reveal, so the board never
 * leaks correctness while a question is open; only "locked" is shown.
 */
export function Scoreboard({ view }: { view: TriviaViewWire }) {
  return (
    <Panel
      title="Standings"
      eyebrow={`${view.answeredCount} / ${view.playerCount} ANSWERED`}
      flush
      data-testid="scoreboard"
    >
      <ol className="divide-y divide-line-subtle">
        {view.scoreboard.map((entry) => (
          <li
            key={entry.playerKey}
            className={cx(
              'flex items-center gap-3 px-5 py-2.5',
              entry.isYou && 'bg-surface-raised',
            )}
          >
            <span className="type-data w-6 shrink-0 text-small text-fg-subtle">
              {String(entry.placement).padStart(PLACE_DIGITS, '0')}
            </span>
            <span className="min-w-0 flex-1 truncate text-body text-fg">
              {entry.displayName}
              {entry.isYou ? <span className="type-eyebrow ml-2 text-fg-subtle">YOU</span> : null}
            </span>
            <span className="flex w-14 shrink-0 justify-center">
              <RoundMark entry={entry} phase={view.phase} />
            </span>
            <span className="type-data w-12 shrink-0 text-right text-body text-fg tabular-nums">
              {formatCount(entry.score)}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
