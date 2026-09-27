import { ErrorBoundary } from '../ErrorBoundary';
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
  const [remainingMs, setRemainingMs] = useState(item.timeLimitMs);

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
    const tick = window.setInterval(() => setRemainingMs(Math.max(0, item.timeLimitMs - (performance.now() - start))), 250);
    const timeout = window.setTimeout(() => handleAnswer({ kind: 'timeout' }), item.timeLimitMs);
    return () => {
      clearInterval(tick);
      clearTimeout(timeout);
    };
  }, [handleAnswer, item.timeLimitMs, practice]);

  return (
    <div className="item-stage">
      {practice ? (
        <div className="item-timer is-untimed">
          <Label>Practice · untimed</Label>
        </div>
      ) : (
        <ItemTimer remainingMs={remainingMs} limitMs={item.timeLimitMs} stopped={phase.kind !== 'answer'} />
      )}
      <div className={`item-body ${phase.kind !== 'answer' ? 'is-answered' : ''}`} aria-hidden={phase.kind === 'confidence'}>
        <ErrorBoundary compact>
<Suspense fallback={<div className="renderer-loading" />}>
          <Renderer item={item} practice={practice} disabled={phase.kind !== 'answer'} onAnswer={handleAnswer} reveal={phase.kind === 'feedback' ? phase.reveal : undefined} />
        </Suspense>
</ErrorBoundary>
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

function ItemTimer({ remainingMs, limitMs, stopped }: { remainingMs: number; limitMs: number; stopped: boolean }) {
  const seconds = Math.ceil(remainingMs / 1000);
  const urgent = seconds <= 10;
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  // Announce only the two warnings, not every second.
  const announce = seconds === 30 ? '30 seconds left' : seconds === 10 ? '10 seconds left' : '';
  return (
    <div className={`item-timer ${urgent ? 'is-urgent' : ''} ${stopped ? 'is-stopped' : ''}`}>
      <div className="item-timer-row">
        <Label>Time</Label>
        <span className="mono item-timer-clock" role="timer" aria-label={`${seconds} seconds remaining`}>
          {clock}
        </span>
      </div>
      <div className="item-timer-track" aria-hidden="true">
        <span style={{ transform: `scaleX(${remainingMs / limitMs})` }} />
      </div>
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}

function practiceExplanation(item: Item): string {
  const k = item.key;
  const answer = item.response.kind === 'choice' ? `option ${(k as number) + 1}` : String(k);
  return `The answer is ${answer}. ${item.explanation ?? ''}`.trim();
}
