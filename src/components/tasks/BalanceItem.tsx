import type { BalanceContent, BalanceSymbol, Pan } from '../../items/generators/balance';
import { NumberEntry } from '../runner/inputs';
import type { ItemRendererProps } from '../runner/types';
import { SYMBOL_NAME, SymbolGlyph } from './Glyph';

const ORDER: BalanceSymbol[] = ['circle', 'triangle', 'square', 'hexagon'];

function PanView({ pan }: { pan: Pan }) {
  const glyphs = ORDER.flatMap((s) => Array.from({ length: pan[s] ?? 0 }, (_, i) => <SymbolGlyph key={`${s}${i}`} s={s} />));
  return <span className="pan-items">{glyphs}</span>;
}

const describe = (pan: Pan) =>
  ORDER.filter((s) => pan[s])
    .map((s) => `${pan[s]} ${SYMBOL_NAME[s]}${pan[s]! > 1 ? 's' : ''}`)
    .join(' and ');

export default function BalanceItem({ item, disabled, onAnswer, reveal }: ItemRendererProps<BalanceContent>) {
  const c = item.content;
  const r = item.response.kind === 'number' ? item.response : { min: 1, max: 99 };
  return (
    <div className="task">
      <p className="task-prompt">Every scale is balanced. Symbols of the same kind weigh the same.</p>
      <div className="scales">
        {c.scales.map((s, i) => (
          <figure key={i} className="scale" aria-label={`Scale ${i + 1}: ${describe(s.left)} balance ${describe(s.right)}`}>
            <div className="scale-pans">
              <div className="scale-pan">
                <PanView pan={s.left} />
              </div>
              <span className="scale-eq mono" aria-hidden="true">=</span>
              <div className="scale-pan">
                <PanView pan={s.right} />
              </div>
            </div>
            <div className="scale-beam" aria-hidden="true" />
            <div className="scale-foot" aria-hidden="true" />
          </figure>
        ))}
      </div>
      <p className="task-prompt balance-question" aria-label={`How many ${SYMBOL_NAME[c.question.unit]}s balance ${describe(c.question.lhs)}?`}>
        <span>How many</span>
        <SymbolGlyph s={c.question.unit} size={22} />
        <span>balance</span>
        <PanView pan={c.question.lhs} />
        <span>?</span>
      </p>
      {reveal ? <p className="task-note">Answer: {String(item.key)}</p> : <NumberEntry min={r.min} max={r.max} disabled={disabled} onSubmit={(v) => onAnswer({ kind: 'number', value: v })} />}
    </div>
  );
}
