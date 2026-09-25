import { useEffect, useRef, useState } from 'react';
import type { ReversalConfig } from '../../tasks/reversal';
import type { ProcedureRendererProps } from '../runner/types';
import { Gate } from './Shell';

const SYMBOLS = ['◆', '●', '▲'];

export default function ReversalTask({ config, onComplete }: ProcedureRendererProps<ReversalConfig>) {
  const [started, setStarted] = useState(false);
  const [t, setT] = useState(0);
  const [outcome, setOutcome] = useState<{ choice: number; win: boolean } | null>(null);
  const [points, setPoints] = useState(0);
  const choices = useRef<number[]>([]);
  const rts = useRef<number[]>([]);
  const shownAt = useRef(0);
  const busy = useRef(false);
  const n = config.probs.length;

  useEffect(() => {
    shownAt.current = performance.now();
  }, [t]);

  const choose = (k: number) => {
    if (busy.current || t >= n) return;
    busy.current = true;
    choices.current.push(k);
    rts.current.push(performance.now() - shownAt.current);
    const win = config.outcomes[t][k];
    setOutcome({ choice: k, win });
    if (win) setPoints((p) => p + 1);
    window.setTimeout(() => {
      setOutcome(null);
      busy.current = false;
      if (t + 1 >= n) onComplete({ choices: choices.current, rts: rts.current });
      else setT(t + 1);
    }, 650);
  };

  useEffect(() => {
    if (!started) return;
    const onKey = (e: KeyboardEvent) => {
      const k = Number(e.key);
      if (k >= 1 && k <= 3) {
        e.preventDefault();
        choose(k - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!started)
    return (
      <Gate title="Collect as many points as you can." onGo={() => setStarted(true)} label="Adaptive choice">
        <p>Each symbol pays a point with its own hidden chance. One is best, but the best one changes from time to time without warning.</p>
        <p>Choose by clicking or pressing 1, 2 or 3. There are {n} choices.</p>
      </Gate>
    );
  return (
    <div className="task reversal">
      <div className="task-counter">
        <span>Points · {points}</span>
        <span>{t + 1} / {n}</span>
      </div>
      <div className="reversal-options">
        {SYMBOLS.map((s, i) => (
          <button
            key={i}
            type="button"
            className={`reversal-option ${outcome?.choice === i ? (outcome.win ? 'is-win' : 'is-loss') : ''}`}
            onClick={() => choose(i)}
            aria-label={`Symbol ${i + 1}`}
          >
            <span className="reversal-symbol">{s}</span>
            <span className="mono reversal-n">{i + 1}</span>
          </button>
        ))}
      </div>
      <p className="reversal-outcome mono" role="status">
        {outcome ? (outcome.win ? '+1 point' : 'No point') : ' '}
      </p>
    </div>
  );
}
