import { motion } from 'motion/react';
import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getParadigm } from '../../engine/registry';
import type { ItemParadigm } from '../../items/paradigm';
import type { Item, ResponseValue } from '../../types';
import { itemRenderer } from '../tasks';
import { Button, Label } from '../ui';
import { Confidence } from './Confidence';
import type { Reveal } from './types';

export interface AnswerPayload {
  value: ResponseValue;
  rtMs: number;
  confidence?: number;
  aux?: ResponseValue;
}

interface Props {
  item: Item;
  practice: boolean;
  askConfidence: boolean;
  onDone(payload: AnswerPayload): void;
}

type Phase = { kind: 'answer' } | { kind: 'confidence'; payload: AnswerPayload } | { kind: 'feedback'; payload: AnswerPayload; reveal: Reveal };

export function ItemStage({ item, practice, askConfidence, onDone }: Props) {
  const paradigm = getParadigm(item.paradigm) as ItemParadigm;
  const Renderer = itemRenderer(item.paradigm);
  const [phase, setPhase] = useState<Phase>({ kind: 'answer' });
  const onset = useRef<number>(performance.now());
  const locked = useRef(false);
  const finished = useRef(false);
  const [remaining, setRemaining] = useState(1);

  // Onset = first frame after the item has been painted.
  useLayoutEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame((t) => (onset.current = t));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  const finish = useCallback(
    (p: AnswerPayload) => {
      if (finished.current) return;
      finished.current = true;
      onDone(p);
    },
    [onDone],
  );

  const handleAnswer = useCallback(
    (value: ResponseValue, opts?: { aux?: ResponseValue; rtMs?: number }) => {
      if (locked.current) return;
      locked.current = true;
      const payload: AnswerPayload = { value, aux: opts?.aux, rtMs: opts?.rtMs ?? performance.now() - onset.current };
      if (practice) {
        const result = paradigm.score(item, value, opts?.aux);
        setPhase({ kind: 'feedback', payload, reveal: { key: item.key, chosen: value, correct: result.correct } });
      } else if (askConfidence && value.kind !== 'timeout') {
        setPhase({ kind: 'confidence', payload });
      } else {
        finish(payload);
      }
    },
    [askConfidence, finish, item, paradigm, practice],
  );

  // Time limit. Practice items are untimed.
  useEffect(() => {
    if (practice) return;
    const start = performance.now();
    const tick = window.setInterval(() => setRemaining(Math.max(0, 1 - (performance.now() - start) / item.timeLimitMs)), 500);
    const timeout = window.setTimeout(() => handleAnswer({ kind: 'timeout' }), item.timeLimitMs);
    return () => {
      clearInterval(tick);
      clearTimeout(timeout);
    };
  }, [handleAnswer, item.timeLimitMs, practice]);

  return (
    <div className="item-stage">
      {!practice && remaining < 0.3 && phase.kind === 'answer' ? (
        <div className="time-left" role="timer" aria-label="Time remaining">
          <span style={{ transform: `scaleX(${remaining / 0.3})` }} />
        </div>
      ) : null}
      <div className={`item-body ${phase.kind !== 'answer' ? 'is-answered' : ''}`} aria-hidden={phase.kind === 'confidence'}>
        <Suspense fallback={<div className="renderer-loading" />}>
          <Renderer item={item} practice={practice} disabled={phase.kind !== 'answer'} onAnswer={handleAnswer} reveal={phase.kind === 'feedback' ? phase.reveal : undefined} />
        </Suspense>
      </div>
      {phase.kind === 'confidence' ? (
        <motion.div className="stage-overlay" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          <Confidence onSubmit={(c) => finish({ ...phase.payload, confidence: c })} />
        </motion.div>
      ) : null}
      {phase.kind === 'feedback' ? (
        <motion.div className="practice-feedback" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} role="status">
          <div>
            <Label>Practice</Label>
            <p className={`feedback-verdict ${phase.reveal.correct ? 'is-correct' : 'is-incorrect'}`}>{phase.reveal.correct ? 'Correct.' : 'Not quite.'}</p>
            {item.explanation ? <p className="feedback-explain">{practiceExplanation(item)}</p> : null}
          </div>
          <Button onClick={() => finish(phase.payload)} kbd="↵" autoFocus>
            Continue
          </Button>
        </motion.div>
      ) : null}
    </div>
  );
}

function practiceExplanation(item: Item): string {
  const k = item.key;
  const answer = item.response.kind === 'choice' ? `option ${(k as number) + 1}` : String(k);
  return `The answer is ${answer}. ${item.explanation ?? ''}`.trim();
}
