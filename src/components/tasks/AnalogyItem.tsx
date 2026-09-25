import type { AnalogyContent } from '../../items/generators/analogy';
import { TextEntry } from '../runner/inputs';
import type { ItemRendererProps } from '../runner/types';
import { Frame } from '../ui';

export default function AnalogyItem({ item, disabled, onAnswer, reveal }: ItemRendererProps<AnalogyContent>) {
  const c = item.content;
  return (
    <div className="task">
      <p className="task-prompt">Apply the same transformation to the last string.</p>
      <Frame label="Transformation">
        <div className="analogy">
          {c.examples.map((e, i) => (
            <div key={i} className="analogy-row mono">
              <span>{e.from}</span>
              <span className="analogy-arrow" aria-label="becomes">→</span>
              <span>{e.to}</span>
            </div>
          ))}
          <div className="analogy-row analogy-query mono">
            <span>{c.query}</span>
            <span className="analogy-arrow" aria-label="becomes">→</span>
            <span className="analogy-unknown">{reveal ? String(item.key) : '?'}</span>
          </div>
        </div>
      </Frame>
      {reveal ? null : <TextEntry maxLength={16} disabled={disabled} placeholder="letters" pattern={/[^a-zA-Z]/g} onSubmit={(v) => onAnswer({ kind: 'text', value: (v ?? '').toLowerCase() })} />}
    </div>
  );
}
