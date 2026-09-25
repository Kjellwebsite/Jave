import type { LanguageContent } from '../../items/generators/language';
import { ChoiceGrid } from '../runner/inputs';
import type { ItemRendererProps } from '../runner/types';
import { Label } from '../ui';

export default function LanguageItem({ item, disabled, onAnswer, reveal }: ItemRendererProps<LanguageContent>) {
  const c = item.content;
  return (
    <div className="task">
      <div className="lang-examples">
        <Label>Examples</Label>
        <table className="lang-table">
          <tbody>
            {c.examples.map((e, i) => (
              <tr key={i}>
                <td className="mono lang-native">{e.native}</td>
                <td className="lang-english">{e.english}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="task-prompt">
        Translate: <strong>{c.target}</strong>
      </p>
      <ChoiceGrid className="lang-options" columns={2} options={c.options.map((o) => <span className="mono">{o}</span>)} disabled={disabled} revealKey={reveal ? (item.key as number) : undefined} onSubmit={(index) => onAnswer({ kind: 'choice', index })} />
    </div>
  );
}
