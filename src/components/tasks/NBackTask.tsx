import { useEffect, useRef, useState } from 'react';
import type { NBackBlock } from '../../tasks/nback';
import type { ProcedureRendererProps } from '../runner/types';
import { Field, Gate } from './Shell';
import { Cancelled, sleep } from './trial';

interface Cfg {
  blocks: NBackBlock[];
  itemMs: number;
  soaMs: number;
}

export default function NBackTask({ config, input, onComplete }: ProcedureRendererProps<Cfg>) {
  const [block, setBlock] = useState(0);
  const [running, setRunning] = useState(false);
  const [counter, setCounter] = useState('');
  const stim = useRef<HTMLDivElement>(null);
  const pad = useRef<HTMLButtonElement>(null);
  const results = useRef<{ responses: boolean[] }[]>([]);

  useEffect(() => {
    if (!running) return;
    const ac = new AbortController();
    const b = config.blocks[block];
    const responses = new Array(b.letters.length).fill(false);
    let current = -1;
    const respond = () => {
      if (current >= 0) {
        responses[current] = true;
        stim.current?.classList.add('is-marked');
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' && !e.repeat) {
        e.preventDefault();
        respond();
      }
    };
    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      respond();
    };
    window.addEventListener('keydown', onKey);
    pad.current?.addEventListener('pointerdown', onDown);
    const run = async () => {
      await sleep(1000, ac.signal);
      for (let i = 0; i < b.letters.length; i++) {
        current = i;
        setCounter(`${i + 1} / ${b.letters.length}`);
        const el = stim.current!;
        el.classList.remove('is-marked');
        el.textContent = b.letters[i];
        el.classList.add('is-on');
        await sleep(config.itemMs, ac.signal);
        el.classList.remove('is-on');
        await sleep(config.soaMs - config.itemMs, ac.signal);
      }
      results.current[block] = { responses };
      if (block + 1 < config.blocks.length) {
        setRunning(false);
        setBlock(block + 1);
      } else onComplete({ blocks: results.current });
    };
    run().catch((e) => {
      if (!(e instanceof Cancelled)) throw e;
    });
    return () => {
      ac.abort();
      window.removeEventListener('keydown', onKey);
      pad.current?.removeEventListener('pointerdown', onDown);
    };
  }, [running, block, config, onComplete]);

  const n = config.blocks[block].n;
  if (!running)
    return (
      <Gate label={`Block ${block + 1} of ${config.blocks.length}`} title={`${n}-back`} onGo={() => setRunning(true)}>
        <p>
          Letters appear one at a time. {input === 'touch' ? 'Tap Match' : 'Press Space'} when a letter is the same as the one {n} steps back.
        </p>
        <p>Example for {n}-back: {n === 2 ? 'K · R · K → match' : 'K · R · S · K → match'}. Letters that match {n - 1} or {n + 1} steps back are not matches.</p>
      </Gate>
    );
  return (
    <div>
      <div className="task-counter">
        <span>{n}-back</span>
        <span>{counter}</span>
      </div>
      <Field className="no-cross">
        <div ref={stim} className="stim nback-letter mono" />
      </Field>
      <div className="touch-row">
        <button type="button" ref={pad} className="touch-pad">
          Space · Match
        </button>
      </div>
    </div>
  );
}
