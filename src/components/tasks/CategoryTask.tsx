import { useEffect, useRef, useState } from 'react';
import { type CategoryConfig, categoryOf, reachedCriterion } from '../../tasks/category';
import type { ProcedureRendererProps } from '../runner/types';
import { Button, Label } from '../ui';
import { Creature } from './Creature';
import { Gate } from './Shell';
import { seeded } from './trial';

type TrainTrial = { stimulus: number; response: 0 | 1 | null; rt: number };
type TransferTrial = { stimulus: number; response: 0 | 1 | null };

export default function CategoryTask({ config, onComplete }: ProcedureRendererProps<CategoryConfig>) {
  const [p, setP] = useState(0);
  const [stage, setStage] = useState<'gate' | 'train' | 'transfer-gate' | 'transfer'>('gate');
  const [trial, setTrial] = useState(0);
  const [feedback, setFeedback] = useState<boolean | null>(null);
  const results = useRef<{ training: TrainTrial[]; transfer: TransferTrial[] }[]>([]);
  const shownAt = useRef(0);
  const busy = useRef(false);
  const problem = config.problems[p];

  // Block order: each block of 8 is a fresh permutation of the training set.
  const order = useRef<number[]>([]);
  if (order.current.length === 0 || (stage === 'train' && trial === 0 && !results.current[p])) {
    const rand = seeded(1000 + p);
    order.current = Array.from({ length: config.maxBlocks }, () => [0, 1, 2, 3, 4, 5, 6, 7].sort(() => rand() - 0.5)).flat();
  }
  const transferOrder = useRef<number[]>([]);

  useEffect(() => {
    shownAt.current = performance.now();
  }, [trial, stage, p]);

  const answer = (label: 0 | 1) => {
    if (busy.current) return;
    busy.current = true;
    if (!results.current[p]) results.current[p] = { training: [], transfer: [] };
    const r = results.current[p];
    if (stage === 'train') {
      const idx = order.current[trial];
      r.training.push({ stimulus: idx, response: label, rt: performance.now() - shownAt.current });
      const ok = categoryOf(problem, problem.train[idx]) === label;
      setFeedback(ok);
      window.setTimeout(() => {
        setFeedback(null);
        busy.current = false;
        const n = r.training.length;
        if (n % config.blockSize === 0) {
          const blocks: number[] = [];
          r.training.forEach((t, j) => {
            const b = Math.floor(j / config.blockSize);
            blocks[b] = (blocks[b] ?? 0) + (categoryOf(problem, problem.train[t.stimulus]) === t.response ? 1 : 0);
          });
          if (reachedCriterion(blocks, config.blockSize) > 0 || blocks.length >= config.maxBlocks) {
            const rand = seeded(2000 + p);
            transferOrder.current = [0, 1, 2, 3, 4, 5, 6, 7].sort(() => rand() - 0.5);
            setTrial(0);
            setStage('transfer-gate');
            return;
          }
        }
        setTrial(n);
      }, 800);
    } else if (stage === 'transfer') {
      r.transfer.push({ stimulus: transferOrder.current[trial], response: label });
      window.setTimeout(() => {
        busy.current = false;
        if (trial + 1 < 8) setTrial(trial + 1);
        else if (p + 1 < config.problems.length) {
          setP(p + 1);
          setTrial(0);
          order.current = [];
          setStage('gate');
        } else onComplete({ problems: results.current });
      }, 250);
    }
  };

  useEffect(() => {
    if (stage !== 'train' && stage !== 'transfer') return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'f' || k === 'a') answer(0);
      else if (k === 'j' || k === 'b') answer(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (stage === 'gate')
    return (
      <Gate label={`Problem ${p + 1} of ${config.problems.length}`} title={p === 0 ? 'Learn the groups.' : 'A new rule.'} onGo={() => setStage('train')}>
        <p>{p === 0 ? 'Each object belongs to group A or B. Guess at first; the feedback tells you whether you were right.' : 'The objects are the same, but the rule is new. Start fresh.'}</p>
        <p>Learning continues until you get two rounds of eight in a row right, or six rounds pass. Keys: F for A, J for B.</p>
      </Gate>
    );
  if (stage === 'transfer-gate')
    return (
      <Gate label={`Problem ${p + 1} · transfer`} title="Now sort new objects." onGo={() => setStage('transfer')} action="Continue">
        <p>Eight objects you have not seen, sorted by the same rule. No feedback.</p>
      </Gate>
    );

  const stim = stage === 'train' ? problem.train[order.current[trial]] : problem.transfer[transferOrder.current[trial]];
  const round = Math.floor(trial / config.blockSize) + 1;
  return (
    <div className="task category">
      <div className="task-counter">
        <span>{stage === 'train' ? `Learning · round ${round}` : 'Transfer · no feedback'}</span>
        <span>
          {stage === 'train' ? `${(trial % config.blockSize) + 1} / ${config.blockSize}` : `${trial + 1} / 8`}
        </span>
      </div>
      <div className="category-stim paper">
        <Creature s={stim} size={180} />
      </div>
      <p className={`rules-feedback ${feedback === null ? '' : feedback ? 'is-correct' : 'is-incorrect'}`} role="status">
        {feedback === null ? ' ' : feedback ? 'Right' : 'Wrong'}
      </p>
      <div className="category-actions">
        <Button variant="secondary" size="lg" onClick={() => answer(0)} kbd="F">
          Group A
        </Button>
        <Button variant="secondary" size="lg" onClick={() => answer(1)} kbd="J">
          Group B
        </Button>
      </div>
      <Label className="category-note">One of the four features never matters.</Label>
    </div>
  );
}
