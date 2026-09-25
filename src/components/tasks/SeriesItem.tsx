import type { SeriesContent } from '../../items/generators/series';
import { NumberEntry } from '../runner/inputs';
import type { ItemRendererProps } from '../runner/types';
import { Frame } from '../ui';

export default function SeriesItem({ item, disabled, onAnswer, reveal }: ItemRendererProps<SeriesContent>) {
  const r = item.response.kind === 'number' ? item.response : { min: -99999, max: 99999 };
  return (
    <div className="task">
      <p className="task-prompt">What is the next term?</p>
      <Frame label="Sequence">
        <ol className="series" aria-label={`Sequence: ${item.content.terms.join(', ')}, then unknown`}>
          {item.content.terms.map((t, i) => (
            <li key={i} className="series-term mono">
              {t}
            </li>
          ))}
          <li className="series-term series-next mono">{reveal ? String(item.key) : '?'}</li>
        </ol>
      </Frame>
      {reveal ? null : <NumberEntry min={r.min} max={r.max} disabled={disabled} onSubmit={(v) => onAnswer({ kind: 'number', value: v })} />}
    </div>
  );
}
