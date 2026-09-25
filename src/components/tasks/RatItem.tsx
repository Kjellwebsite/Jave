import type { RatContent } from '../../items/generators/rat';
import { TextEntry } from '../runner/inputs';
import type { ItemRendererProps } from '../runner/types';

export default function RatItem({ item, disabled, onAnswer, reveal }: ItemRendererProps<RatContent>) {
  return (
    <div className="task">
      <p className="task-prompt">Which word links all three?</p>
      <div className="rat-words" aria-label={`Words: ${item.content.words.join(', ')}`}>
        {item.content.words.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      {reveal ? (
        <p className="task-note">Answer: {String(item.key)}</p>
      ) : (
        <TextEntry maxLength={20} allowSkip disabled={disabled} pattern={/[^a-zA-Z]/g} onSubmit={(v) => onAnswer(v === null ? { kind: 'text', value: '' } : { kind: 'text', value: v })} />
      )}
    </div>
  );
}
