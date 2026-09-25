import type { GamesContent } from '../../items/generators/games';
import { ChoiceGrid } from '../runner/inputs';
import type { ItemRendererProps } from '../runner/types';
import { Label } from '../ui';

export default function GamesItem({ item, disabled, onAnswer, reveal }: ItemRendererProps<GamesContent>) {
  const c = item.content;
  const names = ['A', 'B'];
  return (
    <div className="task task-split">
      <div className="game-board">
        <Label>Position · your move</Label>
        <p className="game-rules">
          Players take turns. On each turn you remove {c.moves.slice(0, -1).join(', ')}
          {c.moves.length > 1 ? ' or ' : ''}
          {c.moves[c.moves.length - 1]} tokens{c.heaps.length > 1 ? ' from one heap' : ''}.{' '}
          {c.misere ? 'Whoever takes the last token loses.' : 'Whoever cannot move loses, so taking the last token wins.'}
        </p>
        {c.heaps.map((h, i) => (
          <div key={i} className="heap" aria-label={`${c.heaps.length > 1 ? `Heap ${names[i]}: ` : ''}${h} tokens`}>
            {c.heaps.length > 1 ? <span className="mono heap-name">{names[i]}</span> : null}
            <span className="heap-tokens" aria-hidden="true">
              {Array.from({ length: h }, (_, j) => (
                <span key={j} className="token" />
              ))}
            </span>
            <span className="mono heap-count">{h}</span>
          </div>
        ))}
        <p className="task-note">Your opponent plays perfectly.</p>
      </div>
      <div className="task">
        <p className="task-prompt task-prompt-left">Which move guarantees that you win?</p>
        <ChoiceGrid options={c.options.map((o) => o.label)} disabled={disabled} revealKey={reveal ? (item.key as number) : undefined} onSubmit={(index) => onAnswer({ kind: 'choice', index })} />
      </div>
    </div>
  );
}
