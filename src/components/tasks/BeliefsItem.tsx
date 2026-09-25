import { useRef, useState } from 'react';
import type { BeliefsContent } from '../../items/generators/beliefs';
import { ChoiceGrid } from '../runner/inputs';
import type { ItemRendererProps } from '../runner/types';
import { Label } from '../ui';

export default function BeliefsItem({ item, disabled, onAnswer, reveal }: ItemRendererProps<BeliefsContent>) {
  const c = item.content;
  const start = useRef(performance.now());
  const [belief, setBelief] = useState<{ index: number; rtMs: number } | null>(null);
  return (
    <div className="task task-split">
      <div className="story">
        <Label>Story</Label>
        <ol className="story-list">
          {c.story.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </div>
      <div className="task">
        {belief === null ? (
          <>
            <p className="task-prompt task-prompt-left">{c.question}</p>
            <ChoiceGrid
              options={c.options}
              disabled={disabled}
              revealKey={reveal ? (item.key as number) : undefined}
              submitLabel="Next"
              onSubmit={(index) => setBelief({ index, rtMs: performance.now() - start.current })}
            />
          </>
        ) : (
          <>
            <Label>Check question</Label>
            <p className="task-prompt task-prompt-left">{c.control.question}</p>
            <ChoiceGrid
              key="control"
              options={c.control.options}
              disabled={disabled}
              onSubmit={(index) => onAnswer({ kind: 'choice', index: belief.index }, { aux: { kind: 'choice', index }, rtMs: belief.rtMs })}
            />
          </>
        )}
      </div>
    </div>
  );
}
