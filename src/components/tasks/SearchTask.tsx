import { useEffect, useRef, useState } from 'react';
import type { SearchTrial } from '../../tasks/search';
import type { ProcedureRendererProps } from '../runner/types';
import { Field, Gate } from './Shell';
import { Cancelled, paintTime, seeded, sleep, waitResponse } from './trial';

const PRACTICE: SearchTrial[] = [
  { setSize: 8, present: true, seed: 11 },
  { setSize: 8, present: false, seed: 12 },
  { setSize: 16, present: true, seed: 13 },
  { setSize: 16, present: false, seed: 14 },
];

function layout(field: HTMLElement, t: SearchTrial) {
  field.querySelectorAll('.search-item').forEach((n) => n.remove());
  const rand = seeded(t.seed);
  const cols = 8;
  const rows = 5;
  const cells = Array.from({ length: cols * rows }, (_, i) => i).sort(() => rand() - 0.5).slice(0, t.setSize);
  cells.forEach((cell, i) => {
    const el = document.createElement('span');
    el.className = 'search-item';
    el.textContent = t.present && i === 0 ? 'T' : 'L';
    const x = ((cell % cols) + 0.5 + (rand() - 0.5) * 0.5) / cols;
    const y = (Math.floor(cell / cols) + 0.5 + (rand() - 0.5) * 0.5) / rows;
    el.style.left = `${x * 100}%`;
    el.style.top = `${y * 100}%`;
    el.style.transform = `translate(-50%, -50%) rotate(${[0, 90, 180, 270][Math.floor(rand() * 4)]}deg)`;
    el.style.visibility = 'hidden';
    field.appendChild(el);
  });
}

export default function SearchTask({ config, input, onComplete }: ProcedureRendererProps<{ trials: SearchTrial[] }>) {
  const [phase, setPhase] = useState<'gate' | 'run'>('gate');
  const [counter, setCounter] = useState('');
  const field = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const absentPad = useRef<HTMLButtonElement>(null);
  const presentPad = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (phase !== 'run') return;
    const ac = new AbortController();
    const out: { response: boolean | null; rt: number | null }[] = [];
    const run = async () => {
      const all = [...PRACTICE, ...config.trials];
      for (let i = 0; i < all.length; i++) {
        const practice = i < PRACTICE.length;
        const t = all[i];
        setCounter(practice ? `Practice ${i + 1} / ${PRACTICE.length}` : `${i - PRACTICE.length + 1} / ${config.trials.length}`);
        const f = field.current!.querySelector('.field') as HTMLElement;
        if (hint.current) hint.current.textContent = '';
        layout(f, t);
        await sleep(500, ac.signal);
        f.querySelectorAll<HTMLElement>('.search-item').forEach((n) => (n.style.visibility = 'visible'));
        const onset = await paintTime();
        const r = await waitResponse<boolean>({
          keys: { j: true, f: false },
          targets: [
            { el: presentPad.current, value: true },
            { el: absentPad.current, value: false },
          ],
          timeoutMs: 6000,
          signal: ac.signal,
        });
        f.querySelectorAll<HTMLElement>('.search-item').forEach((n) => (n.style.visibility = 'hidden'));
        if (!practice) out.push({ response: r.value, rt: r.value === null ? null : r.t - onset });
        if (practice && hint.current) hint.current.textContent = r.value === null ? 'Too slow' : r.value === t.present ? 'Correct' : t.present ? 'There was a T' : 'There was no T';
        await sleep(practice ? 900 : 450, ac.signal);
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
      <Gate title="Is there a T?" onGo={() => setPhase('run')} label="Visual search">
        <p>Letters appear, rotated. Most are L. Sometimes one is a T.</p>
        <p>{input === 'touch' ? 'Tap Present or Absent.' : 'Press J if a T is present, F if it is absent.'} Four practice trials first.</p>
      </Gate>
    );
  return (
    <div>
      <div className="task-counter">
        <span>Visual search</span>
        <span>{counter}</span>
      </div>
      <div ref={field}>
        <Field className="no-cross">
          <div ref={hint} className="field-feedback" aria-live="polite" />
        </Field>
      </div>
      <div className="touch-row">
        <button type="button" ref={absentPad} className="touch-pad">
          F · Absent
        </button>
        <button type="button" ref={presentPad} className="touch-pad">
          J · Present
        </button>
      </div>
    </div>
  );
}
