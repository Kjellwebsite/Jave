import { useEffect, useRef, useState } from 'react';
import type { FlankerTrial } from '../../tasks/flanker';
import type { ProcedureRendererProps } from '../runner/types';
import { Field, Gate } from './Shell';
import { Cancelled, paintTime, sleep, waitResponse } from './trial';

const PRACTICE: FlankerTrial[] = [
  { direction: 'left', congruent: true },
  { direction: 'right', congruent: false },
  { direction: 'right', congruent: true },
  { direction: 'left', congruent: false },
  { direction: 'left', congruent: true },
  { direction: 'right', congruent: false },
];

const arrows = (t: FlankerTrial) => {
  const c = t.direction === 'left' ? '←' : '→';
  const f = t.congruent ? c : t.direction === 'left' ? '→' : '←';
  return `${f}${f}${c}${f}${f}`;
};

export default function FlankerTask({ config, input, onComplete }: ProcedureRendererProps<{ trials: FlankerTrial[]; itiMs: number }>) {
  const [phase, setPhase] = useState<'gate' | 'run'>('gate');
  const [counter, setCounter] = useState('');
  const stim = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const left = useRef<HTMLButtonElement>(null);
  const right = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (phase !== 'run') return;
    const ac = new AbortController();
    const out: { response: 'left' | 'right' | null; rt: number | null }[] = [];
    const run = async () => {
      const all = [...PRACTICE, ...config.trials];
      for (let i = 0; i < all.length; i++) {
        const practice = i < PRACTICE.length;
        const t = all[i];
        setCounter(practice ? `Practice ${i + 1} / ${PRACTICE.length}` : `${i - PRACTICE.length + 1} / ${config.trials.length}`);
        if (hint.current) hint.current.textContent = '';
        await sleep(500, ac.signal);
        const el = stim.current!;
        el.textContent = arrows(t);
        el.classList.add('is-on');
        const onset = await paintTime();
        const r = await waitResponse<'left' | 'right'>({
          keys: { f: 'left', j: 'right', arrowleft: 'left', arrowright: 'right' },
          targets: [
            { el: left.current, value: 'left' },
            { el: right.current, value: 'right' },
          ],
          timeoutMs: 1500,
          signal: ac.signal,
        });
        el.classList.remove('is-on');
        if (!practice) out.push({ response: r.value, rt: r.value === null ? null : r.t - onset });
        if (practice && hint.current) hint.current.textContent = r.value === null ? 'Too slow' : r.value === t.direction ? 'Correct' : 'Follow the centre arrow';
        await sleep(practice ? 800 : config.itiMs, ac.signal);
      }
      onComplete({ trials: out });
    };
    run().catch((e) => {
      if (!(e instanceof Cancelled)) throw e;
    });
    return () => ac.abort();
  }, [phase, config, onComplete]);

  if (phase === 'gate')
    return (
      <Gate title="Follow the centre arrow." onGo={() => setPhase('run')} label="Interference control">
        <p>Five arrows appear. Only the middle one counts.</p>
        <p>{input === 'touch' ? 'Tap left or right.' : 'Press F for ←, J for →.'} Six practice trials first.</p>
      </Gate>
    );
  return (
    <div>
      <div className="task-counter">
        <span>Interference control</span>
        <span>{counter}</span>
      </div>
      <Field>
        <div ref={stim} className="stim flanker-arrows" />
        <div ref={hint} className="field-feedback" aria-live="polite" />
      </Field>
      <div className="touch-row">
        <button type="button" ref={left} className="touch-pad" aria-label="Left">
          F · ←
        </button>
        <button type="button" ref={right} className="touch-pad" aria-label="Right">
          J · →
        </button>
      </div>
    </div>
  );
}
