import { useEffect, useRef, useState } from 'react';
import type { DualConfig } from '../../tasks/dual';
import { NumberEntry } from '../runner/inputs';
import type { ProcedureRendererProps } from '../runner/types';
import { Field, Gate } from './Shell';
import { Cancelled, paintTime, sleep, waitResponse } from './trial';

type Phase = 'gateA' | 'runA' | 'gateB' | 'runB' | 'countB' | 'gateD' | 'runD' | 'countD';
type ShapeResp = { response: number | null; rt: number | null };

export default function DualTask({ config, input, onComplete }: ProcedureRendererProps<DualConfig>) {
  const [phase, setPhase] = useState<Phase>('gateA');
  const [counter, setCounter] = useState('');
  const shape = useRef<HTMLDivElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  const left = useRef<HTMLButtonElement>(null);
  const right = useRef<HTMLButtonElement>(null);
  const single = useRef<ShapeResp[]>([]);
  const dual = useRef<ShapeResp[]>([]);
  const countOnly = useRef(0);

  const doFlash = () => {
    const el = flash.current;
    if (!el) return;
    const side = Math.floor(Math.random() * 4);
    const pos = 8 + Math.random() * 84;
    el.style.left = side === 0 ? '4%' : side === 1 ? '96%' : `${pos}%`;
    el.style.top = side === 2 ? '6%' : side === 3 ? '94%' : `${pos}%`;
    el.classList.add('is-on');
    window.setTimeout(() => el.classList.remove('is-on'), 160);
  };

  useEffect(() => {
    if (phase !== 'runA' && phase !== 'runB' && phase !== 'runD') return;
    const ac = new AbortController();
    const shapeTrials = async (trials: { shape: number; foreperiodMs: number; flash?: boolean }[], out: ShapeResp[]) => {
      for (let i = 0; i < trials.length; i++) {
        const t = trials[i];
        setCounter(`${i + 1} / ${trials.length}`);
        if (t.flash) window.setTimeout(doFlash, 150 + Math.random() * (t.foreperiodMs - 200));
        await sleep(t.foreperiodMs, ac.signal);
        const el = shape.current!;
        el.className = `stim dual-shape is-on ${t.shape ? 'is-square' : 'is-circle'}`;
        const onset = await paintTime();
        const r = await waitResponse<number>({ keys: { f: 0, j: 1 }, targets: [{ el: left.current, value: 0 }, { el: right.current, value: 1 }], timeoutMs: 1500, signal: ac.signal });
        el.className = 'stim dual-shape';
        out.push({ response: r.value, rt: r.value === null ? null : r.t - onset });
        await sleep(400, ac.signal);
      }
    };
    const run = async () => {
      if (phase === 'runA') {
        await shapeTrials(config.single, single.current);
        setPhase('gateB');
      } else if (phase === 'runB') {
        const start = performance.now();
        config.countOnly.forEach((ms) => window.setTimeout(() => !ac.signal.aborted && doFlash(), ms));
        while (performance.now() - start < config.countOnlyMs) {
          setCounter(`${Math.ceil((config.countOnlyMs - (performance.now() - start)) / 1000)} s`);
          await sleep(250, ac.signal);
        }
        setPhase('countB');
      } else {
        await shapeTrials(config.dual, dual.current);
        setPhase('countD');
      }
    };
    run().catch((e) => {
      if (!(e instanceof Cancelled)) throw e;
    });
    return () => ac.abort();
  }, [phase, config]);

  const keysText = input === 'touch' ? 'Tap left for a circle, right for a square.' : 'F for a circle, J for a square.';
  if (phase === 'gateA')
    return (
      <Gate label="Task A alone" title="Circle or square?" onGo={() => setPhase('runA')}>
        <p>A shape appears in the centre. {keysText} Be fast and accurate.</p>
      </Gate>
    );
  if (phase === 'gateB')
    return (
      <Gate label="Task B alone" title="Count the red flashes." onGo={() => setPhase('runB')}>
        <p>For 30 seconds, small red dots flash briefly at the edges of the panel. Count them silently. You will report the total.</p>
      </Gate>
    );
  if (phase === 'countB' || phase === 'countD')
    return (
      <div className="task">
        <p className="task-prompt">How many red flashes did you count?</p>
        <NumberEntry
          min={0}
          max={99}
          onSubmit={(v) => {
            if (phase === 'countB') {
              countOnly.current = v;
              setPhase('gateD');
            } else onComplete({ single: single.current, dual: dual.current, countOnlyReported: countOnly.current, dualReported: v });
          }}
        />
      </div>
    );
  if (phase === 'gateD')
    return (
      <Gate label="Both tasks" title="Now do both at once." onGo={() => setPhase('runD')}>
        <p>Respond to every shape as before ({keysText}) and at the same time count the red flashes. Keep both as accurate as you can.</p>
      </Gate>
    );
  return (
    <div>
      <div className="task-counter">
        <span>{phase === 'runA' ? 'Task A' : phase === 'runB' ? 'Task B · counting' : 'Both tasks'}</span>
        <span>{counter}</span>
      </div>
      <Field>
        <div ref={shape} className="stim dual-shape" />
        <div ref={flash} className="dual-flash" />
      </Field>
      {phase !== 'runB' ? (
        <div className="touch-row">
          <button type="button" ref={left} className="touch-pad">F · circle</button>
          <button type="button" ref={right} className="touch-pad">J · square</button>
        </div>
      ) : null}
    </div>
  );
}
