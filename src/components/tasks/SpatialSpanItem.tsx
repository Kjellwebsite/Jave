import { useEffect, useRef, useState } from 'react';
import { CORSI_LAYOUT, type SpatialSpanContent } from '../../items/generators/span';
import type { ItemRendererProps } from '../runner/types';
import { Button, Label } from '../ui';

export default function SpatialSpanItem({ item, disabled, onAnswer, reveal }: ItemRendererProps<SpatialSpanContent>) {
  const { sequence, onMs, offMs } = item.content;
  const blocks = useRef<(HTMLButtonElement | null)[]>([]);
  const [phase, setPhase] = useState<'ready' | 'show' | 'input'>('ready');
  const [taps, setTaps] = useState<number[]>([]);
  const inputStart = useRef(0);
  const sent = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];
    timers.push(
      window.setTimeout(() => {
        if (cancelled) return;
        setPhase('show');
        sequence.forEach((b, i) => {
          timers.push(window.setTimeout(() => blocks.current[b]?.classList.add('is-lit'), i * (onMs + offMs)));
          timers.push(window.setTimeout(() => blocks.current[b]?.classList.remove('is-lit'), i * (onMs + offMs) + onMs));
        });
        timers.push(
          window.setTimeout(() => {
            if (cancelled) return;
            inputStart.current = performance.now();
            setPhase('input');
          }, sequence.length * (onMs + offMs) + 150),
        );
      }, 700),
    );
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [sequence, onMs, offMs]);

  const tap = (i: number) => {
    if (phase !== 'input' || disabled || sent.current) return;
    const el = blocks.current[i];
    el?.classList.add('is-tapped');
    window.setTimeout(() => el?.classList.remove('is-tapped'), 160);
    const next = [...taps, i];
    setTaps(next);
    if (next.length === sequence.length) {
      sent.current = true;
      const rtMs = performance.now() - inputStart.current;
      window.setTimeout(() => onAnswer({ kind: 'text', value: next.join('') }, { rtMs }), 220);
    }
  };

  const shown = reveal ? sequence : null;

  return (
    <div className="task span">
      <div className="span-status">
        <Label>{phase === 'input' ? 'Reproduce the sequence' : phase === 'show' ? 'Observe' : 'Get ready'}</Label>
        <span className="mono span-progress" aria-live="polite">
          {phase === 'input' ? `${taps.length} / ${sequence.length}` : `${sequence.length} positions`}
        </span>
      </div>
      <div className={`corsi-board paper ${phase === 'input' ? 'is-input' : ''}`}>
        {CORSI_LAYOUT.map(([x, y], i) => (
          <button
            key={i}
            ref={(el) => {
              blocks.current[i] = el;
            }}
            type="button"
            className="corsi-block"
            style={{ left: `${x}%`, top: `${y}%` }}
            aria-label={`Block ${i + 1}`}
            disabled={phase !== 'input' || disabled}
            onPointerDown={(e) => {
              e.preventDefault();
              tap(i);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                tap(i);
              }
            }}
          >
            {shown && shown.includes(i) ? <span className="mono corsi-order">{shown.indexOf(i) + 1}</span> : null}
          </button>
        ))}
      </div>
      <div className="span-actions">
        <Button variant="ghost" size="sm" disabled={phase !== 'input' || !taps.length || disabled} onClick={() => setTaps((t) => t.slice(0, -1))}>
          Undo last
        </Button>
      </div>
    </div>
  );
}
