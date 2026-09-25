import { useEffect, useRef, useState } from 'react';
import type { PairsConfig } from '../../tasks/pairs';
import { ChoiceGrid } from '../runner/inputs';
import type { ProcedureRendererProps } from '../runner/types';
import { Label } from '../ui';
import { AbstractGlyph } from './AbstractGlyph';
import { Gate } from './Shell';

function Recall({ glyphs, words, test, onDone }: { glyphs: number[]; words: string[]; test: PairsConfig['test']; onDone(r: { choices: (number | null)[]; rts: number[] }): void }) {
  const [i, setI] = useState(0);
  const choices = useRef<(number | null)[]>([]);
  const rts = useRef<number[]>([]);
  const shownAt = useRef(performance.now());
  useEffect(() => {
    shownAt.current = performance.now();
  }, [i]);
  const t = test[i];
  return (
    <div className="task pairs">
      <div className="task-counter">
        <span>Which word belongs to this symbol?</span>
        <span>{i + 1} / {test.length}</span>
      </div>
      <div className="pairs-cue paper">
        <AbstractGlyph seed={glyphs[t.pair]} size={140} />
      </div>
      <ChoiceGrid
        key={i}
        columns={3}
        options={t.options.map((o) => words[o])}
        onSubmit={(index) => {
          choices.current.push(index);
          rts.current.push(performance.now() - shownAt.current);
          if (i + 1 >= test.length) onDone({ choices: choices.current, rts: rts.current });
          else setI(i + 1);
        }}
      />
    </div>
  );
}

export function PairsEncodeTask({ config, onComplete }: ProcedureRendererProps<PairsConfig>) {
  const [phase, setPhase] = useState<'gate' | 'study' | 'gate2' | 'test'>('gate');
  const [k, setK] = useState(-1);
  const total = config.words.length * config.rounds;

  useEffect(() => {
    if (phase !== 'study') return;
    let step = 0;
    const timers: number[] = [];
    const show = () => {
      if (step >= total) {
        setPhase('gate2');
        return;
      }
      setK(step);
      timers.push(
        window.setTimeout(() => {
          setK(-1);
          step++;
          timers.push(window.setTimeout(show, 400));
        }, config.studyMs),
      );
    };
    timers.push(window.setTimeout(show, 600));
    return () => timers.forEach(clearTimeout);
  }, [phase, config, total]);

  if (phase === 'gate')
    return (
      <Gate title="Learn the pairs." onGo={() => setPhase('study')} label="Associative encoding">
        <p>Eight symbols appear, each with a word, for three seconds. All pairs are shown twice.</p>
        <p>Link each symbol to its word however you like, for example with a mental image.</p>
      </Gate>
    );
  if (phase === 'gate2')
    return (
      <Gate title="Now recall." onGo={() => setPhase('test')} label="Immediate recall">
        <p>For each symbol, choose the word it was paired with.</p>
      </Gate>
    );
  if (phase === 'test') return <Recall glyphs={config.glyphs} words={config.words} test={config.test} onDone={onComplete} />;
  const pair = k >= 0 ? k % config.words.length : -1;
  return (
    <div className="task pairs">
      <div className="task-counter">
        <span>Study · round {k >= 0 ? Math.floor(k / config.words.length) + 1 : ''}</span>
        <span>{k >= 0 ? `${(k % config.words.length) + 1} / ${config.words.length}` : ''}</span>
      </div>
      <div className="pairs-study paper" aria-live="polite">
        {pair >= 0 ? (
          <>
            <AbstractGlyph seed={config.glyphs[pair]} size={160} />
            <span className="pairs-word">{config.words[pair]}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function PairsRecallTask({ config, onComplete }: ProcedureRendererProps<{ available: boolean; glyphs: number[]; words: string[]; test: PairsConfig['test'] }>) {
  const [started, setStarted] = useState(false);
  if (!config.available)
    return (
      <Gate title="Nothing to recall." onGo={() => onComplete({ choices: [], rts: [] })} action="Continue">
        <p>The encoding section was not completed in this session.</p>
      </Gate>
    );
  if (!started)
    return (
      <Gate title="The symbols from the beginning." onGo={() => setStarted(true)} label="Delayed recall">
        <p>At the start you learned symbol–word pairs. Choose the word that belonged to each symbol. Take your time.</p>
      </Gate>
    );
  return (
    <>
      <Label className="sr-only">Delayed recall</Label>
      <Recall glyphs={config.glyphs} words={config.words} test={config.test} onDone={onComplete} />
    </>
  );
}
