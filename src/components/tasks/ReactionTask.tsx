import { useEffect, useRef, useState } from 'react';
import type { ReactionConfig } from '../../tasks/reaction';
import type { ProcedureRendererProps } from '../runner/types';
import { Field, Gate } from './Shell';
import { Cancelled, paintTime, sleep, waitResponse } from './trial';

type Trial = { rt: number | null; anticipation: boolean; response?: number | null };
const CHOICE_KEYS = { d: 0, f: 1, j: 2, k: 3 } as const;
const PRACTICE = 3;

export default function ReactionTask({ config, input, onComplete }: ProcedureRendererProps<ReactionConfig>) {
  const [phase, setPhase] = useState<'gate1' | 'run1' | 'gate2' | 'run2'>('gate1');
  const [counter, setCounter] = useState('');
  const dot = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const pads = useRef<(HTMLButtonElement | null)[]>([]);
  const simple = useRef<Trial[]>([]);
  const choice = useRef<Trial[]>([]);

  useEffect(() => {
    if (phase !== 'run1' && phase !== 'run2') return;
    const ac = new AbortController();
    const signal = ac.signal;
    const isChoice = phase === 'run2';
    const setHint = (s: string) => hint.current && (hint.current.textContent = s);
    const run = async () => {
      const trials = isChoice ? config.choice : config.simple;
      const total = PRACTICE + trials.length;
      for (let i = 0; i < total; i++) {
        const practice = i < PRACTICE;
        const t = practice ? { foreperiodMs: 1000 + i * 300, target: i % 4 } : trials[i - PRACTICE];
        setCounter(practice ? `Practice ${i + 1} / ${PRACTICE}` : `${i - PRACTICE + 1} / ${trials.length}`);
        const target = isChoice ? (t as { target: number }).target : 0;
        const el = dot.current!;
        el.className = 'stim rt-dot';
        if (isChoice) el.style.left = `${12.5 + target * 25}%`;
        setHint('');
        const keys = isChoice ? CHOICE_KEYS : { ' ': 0 };
        const targets = isChoice ? pads.current.map((p, j) => ({ el: p, value: j })) : [{ el: field.current, value: 0 }];
        // Foreperiod: any response now is an anticipation.
        const early = await waitResponse<number>({ keys, targets, timeoutMs: t.foreperiodMs, signal });
        if (early.value !== null) {
          if (!practice) (isChoice ? choice : simple).current.push({ rt: null, anticipation: true, response: null });
          setHint('Too early');
          await sleep(900, signal);
          continue;
        }
        el.classList.add('is-on');
        const onset = await paintTime();
        const r = await waitResponse<number>({ keys, targets, timeoutMs: 1500, signal });
        el.classList.remove('is-on');
        const rt = r.value === null ? null : r.t - onset;
        if (!practice) (isChoice ? choice : simple).current.push({ rt, anticipation: false, response: isChoice ? r.value : null });
        if (practice) setHint(rt === null ? 'Too slow' : isChoice && r.value !== target ? 'Wrong position' : `${Math.round(rt)} ms`);
        else if (rt === null) setHint('Too slow');
        await sleep(practice ? 900 : 600, signal);
      }
      if (isChoice) onComplete({ simple: simple.current, choice: choice.current });
      else setPhase('gate2');
    };
    run().catch((e) => {
      if (!(e instanceof Cancelled)) throw e;
    });
    return () => ac.abort();
  }, [phase, config, onComplete]);

  if (phase === 'gate1')
    return (
      <Gate label="Part 1 of 2" title="Simple reaction" onGo={() => setPhase('run1')}>
        <p>{input === 'touch' ? 'Tap the panel' : 'Press Space'} the moment the dot appears. Three practice trials first.</p>
      </Gate>
    );
  if (phase === 'gate2')
    return (
      <Gate label="Part 2 of 2" title="Choice reaction" onGo={() => setPhase('run2')}>
        <p>{input === 'touch' ? 'Tap the pad under the position where the dot appears.' : 'Press D, F, J or K for the four positions, left to right. Keep your fingers resting on the keys.'}</p>
      </Gate>
    );
  const isChoice = phase === 'run2';
  return (
    <div>
      <div className="task-counter" aria-live="off">
        <span>{isChoice ? 'Choice reaction' : 'Simple reaction'}</span>
        <span>{counter}</span>
      </div>
      <div ref={field}>
        <Field className={isChoice ? 'no-cross' : ''}>
          {isChoice ? (
            <div className="rt-slots" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="rt-slot" style={{ left: `${12.5 + i * 25}%` }} />
              ))}
            </div>
          ) : null}
          <div ref={dot} className="stim rt-dot" />
          <div ref={hint} className="field-feedback" aria-live="polite" />
        </Field>
      </div>
      {isChoice ? (
        <div className="touch-row">
          {['D', 'F', 'J', 'K'].map((k, i) => (
            <button
              key={k}
              type="button"
              ref={(el) => {
                pads.current[i] = el;
              }}
              className="touch-pad"
              aria-label={`Position ${i + 1}`}
            >
              {k}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
