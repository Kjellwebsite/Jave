import { useEffect, useRef, useState } from 'react';
import { replayRules, RULE_KEYS, type RulesConfig } from '../../tasks/rules';
import type { ProcedureRendererProps } from '../runner/types';
import { Label } from '../ui';
import { RuleCardView } from './RuleCard';
import { Gate } from './Shell';

export default function RulesTask({ config, onComplete }: ProcedureRendererProps<RulesConfig>) {
  const [started, setStarted] = useState(false);
  const [choices, setChoices] = useState<number[]>([]);
  const [feedback, setFeedback] = useState<boolean | null>(null);
  const rts = useRef<number[]>([]);
  const shownAt = useRef(0);
  const busy = useRef(false);

  const replay = replayRules(config, choices);
  const finished = replay.length > 0 && replay[replay.length - 1].completedRules >= config.order.length;
  const index = choices.length;
  const done = finished || index >= config.deck.length;

  useEffect(() => {
    if (done && started) onComplete({ choices, rts: rts.current });
  }, [done, started, choices, onComplete]);

  useEffect(() => {
    shownAt.current = performance.now();
  }, [index]);

  const choose = (k: number) => {
    if (busy.current || done) return;
    busy.current = true;
    rts.current.push(performance.now() - shownAt.current);
    const next = [...choices, k];
    const r = replayRules(config, next);
    setFeedback(r[r.length - 1].correct);
    window.setTimeout(() => {
      setFeedback(null);
      setChoices(next);
      busy.current = false;
    }, 750);
  };

  useEffect(() => {
    if (!started) return;
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= 4) {
        e.preventDefault();
        choose(n - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!started)
    return (
      <Gate title="Find the hidden rule." onGo={() => setStarted(true)} label="Rule discovery">
        <p>Place each card under one of the four key cards: click it or press 1–4.</p>
        <p>Cards can match by tone, shape or count. After each choice you see whether it was right. The rule changes without warning.</p>
      </Gate>
    );
  if (done) return <div className="renderer-loading" />;
  return (
    <div className="task rules">
      <div className="task-counter">
        <span>Rule discovery</span>
        <span>{index + 1} / {config.deck.length}</span>
      </div>
      <div className="rules-keys" role="group" aria-label="Key cards">
        {RULE_KEYS.map((k, i) => (
          <button key={i} type="button" className="rules-key" onClick={() => choose(i)} aria-label={`Key card ${i + 1}`}>
            <RuleCardView card={k} />
            <span className="mono rules-key-n">{i + 1}</span>
          </button>
        ))}
      </div>
      <div className="rules-current">
        <Label>Current card</Label>
        <RuleCardView card={config.deck[index]} />
        <p className={`rules-feedback ${feedback === null ? '' : feedback ? 'is-correct' : 'is-incorrect'}`} role="status">
          {feedback === null ? ' ' : feedback ? 'Right' : 'Wrong'}
        </p>
      </div>
    </div>
  );
}
