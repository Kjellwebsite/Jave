import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { navigate } from '../app/router';
import { sessionForRunner, setCurrent, setReportSession } from '../app/sessions';
import { ItemStage, type AnswerPayload } from '../components/runner/ItemStage';
import { ProcedureStage } from '../components/runner/ProcedureStage';
import { SectionIntro } from '../components/runner/SectionIntro';
import { Button, Label, ProgressLine, Wordmark } from '../components/ui';
import { saveSession } from '../data/storage';
import { domainInfo } from '../engine/domains';
import { getParadigm, isItemParadigm } from '../engine/registry';
import { dispatch, getStep, resumeSession } from '../engine/session';
import type { Action, Session } from '../types';
import './assessment.css';

function useSession() {
  const [state, setState] = useState<{ session: Session | null; saveFailed: boolean }>(() => {
    const found = sessionForRunner();
    if (!found) return { session: null, saveFailed: false };
    const s = found.fromStorage ? resumeSession(found.session, Date.now()) : found.session;
    if (found.fromStorage) saveSession(s);
    setCurrent(s);
    return { session: s, saveFailed: false };
  });
  const act = useCallback((action: Action) => {
    setState((prev) => {
      if (!prev.session) return prev;
      const next = dispatch(prev.session, action, Date.now());
      const ok = saveSession(next);
      setCurrent(next);
      return { session: next, saveFailed: !ok };
    });
  }, []);
  const replace = useCallback((s: Session) => {
    saveSession(s);
    setCurrent(s);
    setState({ session: s, saveFailed: false });
  }, []);
  return { ...state, act, replace };
}

export default function Assessment() {
  const { session, saveFailed, act, replace } = useSession();
  const [paused, setPaused] = useState(false);
  const [measurementNotice, setMeasurementNotice] = useState<number | null>(null);
  const seenNotice = useRef(new Set<number>());

  // Visibility changes are logged as test conditions.
  useEffect(() => {
    const onVis = () => act({ type: 'event', event: document.hidden ? 'hidden' : 'visible' });
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [act]);

  const step = session ? getStep(session) : null;

  // After the last practice item, tell the user once that measurement begins.
  useEffect(() => {
    if (!session || !step || step.type !== 'item') return;
    const section = session.sections[step.section];
    if (section.practice.length > 0 && step.index === 0 && !seenNotice.current.has(step.section)) {
      seenNotice.current.add(step.section);
      setMeasurementNotice(step.section);
    }
  }, [session, step]);

  useEffect(() => {
    if (session?.status === 'complete') {
      setReportSession(session.id);
      const t = window.setTimeout(() => navigate('report'), 1600);
      return () => clearTimeout(t);
    }
  }, [session?.status, session?.id]);

  if (!session || !step) {
    return (
      <main id="main" className="runner-empty wrap">
        <Label>No assessment in progress</Label>
        <h1>Start an assessment to continue.</h1>
        <Button onClick={() => navigate('setup')}>Choose a format</Button>
      </main>
    );
  }

  const sectionIndex = step.type === 'complete' ? session.plan.length - 1 : step.type === 'intro' ? step.section : step.section;
  const plan = session.plan[sectionIndex];
  const paradigm = getParadigm(plan.paradigm);
  const section = session.sections[sectionIndex];
  const within = step.type === 'item' ? Math.min(1, section.responses.length / plan.stop.maxItems) : 0;
  const overall = session.status === 'complete' ? 1 : (session.cursor + within) / session.plan.length;

  const pause = () => {
    // Pausing replaces the open item, so nobody gains extra viewing time.
    const next = resumeSession(dispatch(session, { type: 'event', event: 'pause' }, Date.now()), Date.now());
    replace(next);
    setPaused(true);
  };

  const onAnswer = (p: AnswerPayload) => {
    if (step.type === 'practice') act({ type: 'practice-answer', stepId: step.stepId, value: p.value });
    else if (step.type === 'item') act({ type: 'answer', stepId: step.stepId, value: p.value, rtMs: p.rtMs, confidence: p.confidence, aux: p.aux });
  };

  const stageKey = step.type === 'complete' ? 'complete' : step.type === 'intro' ? `intro-${step.section}` : step.stepId;

  return (
    <div className="runner">
      <header className="runner-bar">
        <div className="runner-bar-inner">
          <div className="runner-left">
            <Wordmark compact />
            <span className="mono runner-count">
              {String(sectionIndex + 1).padStart(2, '0')}
              <span className="runner-count-total"> / {String(session.plan.length).padStart(2, '0')}</span>
            </span>
          </div>
          <div className="runner-center">
            <Label>{paradigm.group === 'core' ? domainInfo(paradigm.domain).name : paradigm.group}</Label>
            <span className="runner-title">{paradigm.title}</span>
          </div>
          <div className="runner-right">
            {step.type === 'item' ? <span className="mono runner-item">Item {step.index + 1}</span> : null}
            {step.type === 'practice' ? <span className="mono runner-item">Practice</span> : null}
            {session.status === 'active' ? (
              <Button variant="ghost" size="sm" onClick={pause}>
                Pause
              </Button>
            ) : null}
          </div>
        </div>
        <ProgressLine value={overall} label="Assessment progress" />
      </header>

      {saveFailed ? <p className="runner-warning" role="alert">This browser is not saving progress (private mode or full storage). Finish in one sitting.</p> : null}

      <main id="main" className="runner-stage">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={stageKey} className="stage-frame" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            {step.type === 'intro' ? (
              <SectionIntro
                paradigm={paradigm}
                index={step.section}
                total={session.plan.length}
                hasPractice={isItemParadigm(paradigm) && plan.practice > 0}
                onBegin={() => act({ type: 'begin', section: step.section })}
              />
            ) : step.type === 'practice' || step.type === 'item' ? (
              measurementNotice === step.section && step.type === 'item' ? (
                <div className="notice">
                  <Label>Practice complete</Label>
                  <h2>Measurement begins now.</h2>
                  <p>No more feedback from here on. Items adapt to your answers, so expect them to become harder.</p>
                  <Button onClick={() => setMeasurementNotice(null)} kbd="↵" autoFocus>
                    Begin
                  </Button>
                </div>
              ) : (
                <ItemStage item={step.item} practice={step.type === 'practice'} askConfidence={step.type === 'item' && step.confidence} onDone={onAnswer} />
              )
            ) : step.type === 'procedure' ? (
              <ProcedureStage paradigm={plan.paradigm} config={step.config} input={session.device.input} onComplete={(result) => act({ type: 'procedure-result', stepId: step.stepId, result })} />
            ) : (
              <div className="notice">
                <Label>Complete</Label>
                <h2>Assessment complete.</h2>
                <p>Preparing your report.</p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {paused ? (
          <motion.div className="pause-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-labelledby="pause-title">
            <div className="pause-card">
              <Label>Paused</Label>
              <h2 id="pause-title">Take your time.</h2>
              <p>Your progress is saved. The item that was open has been replaced with a new one, so pausing never gives extra viewing time.</p>
              <div className="pause-actions">
                <Button onClick={() => setPaused(false)} autoFocus>
                  Continue
                </Button>
                <Button variant="ghost" onClick={() => navigate('home')}>
                  Leave and resume later
                </Button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
