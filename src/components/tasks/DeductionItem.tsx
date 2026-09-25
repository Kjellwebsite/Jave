import type { DeductionContent } from '../../items/generators/deduction';
import { ChoiceGrid, NumberEntry } from '../runner/inputs';
import type { ItemRendererProps } from '../runner/types';
import { Label } from '../ui';

export default function DeductionItem({ item, disabled, onAnswer, reveal }: ItemRendererProps<DeductionContent>) {
  const c = item.content;
  return (
    <div className="task task-split">
      <div className="premises">
        <Label>Premises</Label>
        <p className="premises-preface">{c.preface}</p>
        <ol className="premise-list">
          {c.premises.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ol>
      </div>
      <div className="task">
        <p className="task-prompt task-prompt-left">{c.question}</p>
        {c.q.type === 'count' ? (
          reveal ? (
            <p className="task-note">Answer: {String(item.key)}</p>
          ) : (
            <NumberEntry min={0} max={7} disabled={disabled} onSubmit={(v) => onAnswer({ kind: 'number', value: v })} />
          )
        ) : (
          <ChoiceGrid options={c.q.options} disabled={disabled} revealKey={reveal ? (item.key as number) : undefined} onSubmit={(index) => onAnswer({ kind: 'choice', index })} />
        )}
      </div>
    </div>
  );
}
