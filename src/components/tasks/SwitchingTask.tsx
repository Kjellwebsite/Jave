import { useEffect, useRef, useState } from 'react';
import { correctSide, type SwitchTrial } from '../../tasks/switching';
import type { ProcedureRendererProps } from '../runner/types';
import { Field, Gate } from './Shell';
import { Cancelled, paintTime, sleep, waitResponse } from './trial';

interface Cfg {
  trials: SwitchTrial[];
  ctiMs: number;
  itiMs: number;
}

const BLOCK_INFO = [
  { title: 'Odd or even', body: 'Circle frame: is the digit odd (F) or even (J)?' },
  { title: 'Low or high', body: 'Square frame: is the digit below 5 (F) or above 5 (J)?' },
  { title: 'Both rules, mixed', body: 'The frame now changes unpredictably. Circle: odd F / even J. Square: low F / high J.' },
];

export default function SwitchingTask({ config, input, onComplete }: ProcedureRendererProps<Cfg>) {
  const [block, setBlock] = useState(0);
  const [running, setRunning] = useState(false);
  const [counter, setCounter] = useState('');
  const frame = useRef<HTMLDivElement>(null);
  const digit = useRef<HTMLSpanElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const left = useRef<HTMLButtonElement>(null);
  const right = useRef<HTMLButtonElement>(null);
  const results = useRef<{ response: 'left' | 'right' | null; rt: number | null }[]>([]);

  useEffect(() => {
    if (!running) return;
    const ac = new AbortController();
    const blockTrials = config.trials.map((t, i) => ({ t, i })).filter((x) => x.t.block === block);
    const run = async () => {
      // Short practice with feedback before each block.
      const practice = blockTrials.slice(0, 4).map((x) => x.t);
      const all = [...practice.map((t) => ({ t, i: -1 })), ...blockTrials];
      for (let n = 0; n < all.length; n++) {
        const { t, i } = all[n];
        const isPractice = n < practice.length;
        setCounter(isPractice ? `Practice ${n + 1} / ${practice.length}` : `${n - practice.length + 1} / ${blockTrials.length}`);
        if (hint.current) hint.current.textContent = '';
        const f = frame.current!;
        digit.current!.textContent = '';
        f.className = `switch-frame is-on ${t.task === 'parity' ? 'is-circle' : 'is-square'}`;
        await sleep(config.ctiMs, ac.signal);
        digit.current!.textContent = String(t.digit);
        const onset = await paintTime();
        const r = await waitResponse<'left' | 'right'>({
          keys: { f: 'left', j: 'right' },
          targets: [
            { el: left.current, value: 'left' },
            { el: right.current, value: 'right' },
          ],
          timeoutMs: 3000,
          signal: ac.signal,
        });
        f.className = 'switch-frame';
        digit.current!.textContent = '';
        if (!isPractice) results.current[i] = { response: r.value, rt: r.value === null ? null : r.t - onset };
        if (isPractice && hint.current) hint.current.textContent = r.value === null ? 'Too slow' : r.value === correctSide(t) ? 'Correct' : 'Check the frame and the rule';
        await sleep(isPractice ? 900 : config.itiMs, ac.signal);
      }
      if (block < 2) {
        setRunning(false);
        setBlock(block + 1);
      } else onComplete({ trials: config.trials.map((_, i) => results.current[i] ?? { response: null, rt: null }) });
    };
    run().catch((e) => {
      if (!(e instanceof Cancelled)) throw e;
    });
    return () => ac.abort();
  }, [running, block, config, onComplete]);

  if (!running)
    return (
      <Gate label={`Block ${block + 1} of 3`} title={BLOCK_INFO[block].title} onGo={() => setRunning(true)}>
        <p>{BLOCK_INFO[block].body}</p>
        <p>{input === 'touch' ? 'Use the left and right pads for F and J.' : 'Keep your fingers on F and J.'} Four practice trials first.</p>
      </Gate>
    );
  return (
    <div>
      <div className="task-counter">
        <span>{BLOCK_INFO[block].title}</span>
        <span>{counter}</span>
      </div>
      <Field className="no-cross">
        <div ref={frame} className="switch-frame">
          <span ref={digit} className="switch-digit mono" />
        </div>
        <div ref={hint} className="field-feedback" aria-live="polite" />
        <div className="field-hint">○ odd F · even J   □ low F · high J</div>
      </Field>
      <div className="touch-row">
        <button type="button" ref={left} className="touch-pad">F · odd / low</button>
        <button type="button" ref={right} className="touch-pad">J · even / high</button>
      </div>
    </div>
  );
}
