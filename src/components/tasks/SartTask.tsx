import { useEffect, useRef, useState } from 'react';
import { SART_TARGET } from '../../tasks/sart';
import type { ProcedureRendererProps } from '../runner/types';
import { Field, Gate } from './Shell';
import { Cancelled, paintTime, sleep } from './trial';

interface Cfg {
  digits: number[];
  soaMs: number;
  displayMs: number;
  fontSizes: number[];
}

const PRACTICE = [4, 8, 3, 1, 6, 3, 9, 2, 5];

export default function SartTask({ config, input, onComplete }: ProcedureRendererProps<Cfg>) {
  const [phase, setPhase] = useState<'gate' | 'practice' | 'gate2' | 'run'>('gate');
  const [counter, setCounter] = useState('');
  const stim = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const fieldWrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (phase !== 'practice' && phase !== 'run') return;
    const ac = new AbortController();
    const practice = phase === 'practice';
    const digits = practice ? PRACTICE : config.digits;
    const rts: (number | null)[] = [];
    let onset = 0;
    let responded = false;
    let current = -1;
    const respond = (t: number) => {
      if (current < 0 || responded) return;
      responded = true;
      rts[current] = t - onset;
      if (practice && hint.current) hint.current.textContent = digits[current] === SART_TARGET ? 'That was a 3: do not respond' : '';
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' && !e.repeat) {
        e.preventDefault();
        respond(e.timeStamp);
      }
    };
    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      respond(e.timeStamp);
    };
    window.addEventListener('keydown', onKey);
    fieldWrap.current?.addEventListener('pointerdown', onDown);
    const run = async () => {
      await sleep(800, ac.signal);
      for (let i = 0; i < digits.length; i++) {
        current = i;
        responded = false;
        rts[i] = null;
        setCounter(practice ? `Practice ${i + 1} / ${digits.length}` : '');
        const el = stim.current!;
        el.textContent = String(digits[i]);
        el.style.fontSize = `${practice ? 72 : config.fontSizes[i]}px`;
        el.classList.add('is-on');
        onset = await paintTime();
        await sleep(config.displayMs, ac.signal);
        el.textContent = '⊗';
        el.style.fontSize = '64px';
        await sleep(config.soaMs - config.displayMs, ac.signal);
        el.classList.remove('is-on');
        if (practice && hint.current && !responded && digits[i] !== SART_TARGET) hint.current.textContent = 'Respond to every digit except 3';
      }
      if (practice) setPhase('gate2');
      else onComplete({ rts: config.digits.map((_, i) => rts[i] ?? null) });
    };
    run().catch((e) => {
      if (!(e instanceof Cancelled)) throw e;
    });
    return () => {
      ac.abort();
      window.removeEventListener('keydown', onKey);
      fieldWrap.current?.removeEventListener('pointerdown', onDown);
    };
  }, [phase, config, onComplete]);

  if (phase === 'gate')
    return (
      <Gate title="Every digit except 3." onGo={() => setPhase('practice')} label="Sustained attention">
        <p>Digits appear one after another. {input === 'touch' ? 'Tap the panel' : 'Press Space'} for every digit as it appears, except 3: then do nothing.</p>
        <p>Speed and accuracy matter equally. A short practice comes first.</p>
      </Gate>
    );
  if (phase === 'gate2')
    return (
      <Gate title="The test lasts about four minutes." onGo={() => setPhase('run')} action="Begin" label="Sustained attention">
        <p>No more feedback. Keep a steady rhythm and stay with the stream.</p>
      </Gate>
    );
  return (
    <div>
      <div className="task-counter">
        <span>Sustained attention</span>
        <span>{counter}</span>
      </div>
      <div ref={fieldWrap}>
        <Field className="no-cross">
          <div ref={stim} className="stim sart-digit mono" />
          <div ref={hint} className="field-feedback" aria-live="polite" />
        </Field>
      </div>
    </div>
  );
}
