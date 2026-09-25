import type { TowerContent } from '../../items/generators/tower';
import { NumberEntry } from '../runner/inputs';
import type { ItemRendererProps } from '../runner/types';
import { Label } from '../ui';

const BALL_FILL = ['#181a1d', '#737981', '#c3c7cc', '#ffffff'];
const BALL_TEXT = ['#ffffff', '#ffffff', '#181a1d', '#181a1d'];
const BALL_NAME = ['A', 'B', 'C', 'D'];

function Pegs({ caps, pegs, label }: { caps: number[]; pegs: number[][]; label: string }) {
  const maxCap = Math.max(...caps);
  const unit = 26;
  const width = caps.length * 70 + 20;
  const height = maxCap * unit + 30;
  const desc = pegs.map((p, i) => `peg ${i + 1}: ${p.length ? p.map((b) => BALL_NAME[b]).join(', ') : 'empty'} (holds ${caps[i]})`).join('; ');
  return (
    <figure className="tower-fig">
      <Label>{label}</Label>
      <svg viewBox={`0 0 ${width} ${height}`} className="tower-svg paper" role="img" aria-label={`${label}. Bottom to top, ${desc}`}>
        <line x1="10" y1={height - 12} x2={width - 10} y2={height - 12} stroke="#181a1d" strokeWidth="2" />
        {caps.map((cap, i) => {
          const x = 45 + i * 70;
          return (
            <g key={i}>
              <line x1={x} y1={height - 12} x2={x} y2={height - 12 - cap * unit - 4} stroke="#9aa0a7" strokeWidth="3" strokeLinecap="round" />
              {pegs[i].map((b, j) => (
                <g key={b}>
                  <circle cx={x} cy={height - 12 - unit / 2 - j * unit} r={unit / 2 - 1.5} fill={BALL_FILL[b]} stroke="#181a1d" strokeWidth="1.2" />
                  <text x={x} y={height - 12 - unit / 2 - j * unit + 4} textAnchor="middle" fontSize="11" fontFamily="var(--font-mono)" fill={BALL_TEXT[b]}>
                    {BALL_NAME[b]}
                  </text>
                </g>
              ))}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export default function TowerItem({ item, disabled, onAnswer, reveal }: ItemRendererProps<TowerContent>) {
  const c = item.content;
  return (
    <div className="task">
      <p className="task-prompt">What is the smallest number of moves that turns the start into the goal?</p>
      <p className="task-note">Move one ball at a time, only the top ball of a peg, and never exceed a peg's height. Plan it in your head.</p>
      <div className="tower">
        <Pegs caps={c.capacities} pegs={c.start} label="Start" />
        <span className="tower-arrow" aria-hidden="true">→</span>
        <Pegs caps={c.capacities} pegs={c.goal} label="Goal" />
      </div>
      {reveal ? <p className="task-note">Answer: {String(item.key)} moves</p> : <NumberEntry min={1} max={20} disabled={disabled} onSubmit={(v) => onAnswer({ kind: 'number', value: v })} />}
    </div>
  );
}
