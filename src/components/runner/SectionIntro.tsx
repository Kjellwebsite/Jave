import { motion } from 'motion/react';
import { useEffect } from 'react';
import { domainInfo } from '../../engine/domains';
import type { Paradigm } from '../../items/paradigm';
import { Button, Label, Tag } from '../ui';

export function SectionIntro({ paradigm, index, total, hasPractice, onBegin }: { paradigm: Paradigm; index: number; total: number; hasPractice: boolean; onBegin(): void }) {
  const domain = domainInfo(paradigm.domain);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !(e.target as HTMLElement).closest('button, input, textarea')) {
        e.preventDefault();
        onBegin();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBegin]);
  const groupLabel = paradigm.group === 'core' ? domain.name : paradigm.group === 'performance' ? `${domain.name} · performance` : paradigm.group === 'creativity' ? 'Creativity' : 'Applied';
  return (
    <section className="intro" aria-labelledby="intro-title">
      <div className="intro-head">
        <motion.span className="intro-number" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.2, 0.7, 0.1, 1] }}>
          {String(index + 1).padStart(2, '0')}
        </motion.span>
        <div className="intro-meta">
          <Label>{groupLabel}</Label>
          <span className="mono intro-of">
            {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
          </span>
        </div>
      </div>
      <div className="intro-rule" />
      <motion.h1 id="intro-title" className="intro-title" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, duration: 0.5 }}>
        {paradigm.title}
      </motion.h1>
      <p className="intro-subtitle">{paradigm.subtitle}</p>
      <ol className="intro-steps">
        {paradigm.instructions.map((line, i) => (
          <motion.li key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 + i * 0.06, duration: 0.45 }}>
            {line}
          </motion.li>
        ))}
      </ol>
      <div className="intro-foot">
        <div className="intro-tags">
          <Tag tone="outline">~{paradigm.minutes} min</Tag>
          {paradigm.kind === 'items' ? <Tag tone="outline">Adaptive</Tag> : <Tag tone="outline">Timed trials</Tag>}
          {paradigm.input === 'keyboard-preferred' ? <Tag tone="outline">Keyboard recommended</Tag> : null}
          {paradigm.experimental ? <Tag>Experimental</Tag> : null}
        </div>
        <Button size="lg" onClick={onBegin} kbd="↵">
          {hasPractice ? 'Start practice' : 'Begin'}
        </Button>
      </div>
    </section>
  );
}
