import { useEffect, useRef, useState } from 'react';
import { DIRECTIONS, type OrientationContent } from '../../items/generators/orientation';
import type { ItemRendererProps } from '../runner/types';
import { Button, Label } from '../ui';

const LABELS = ['Front', 'Front-right', 'Right', 'Back-right', 'Back', 'Back-left', 'Left', 'Front-left'];

function Dial({ selected, onSelect, disabled, revealKey }: { selected: number | null; onSelect(i: number): void; disabled?: boolean; revealKey?: number }) {
  return (
    <div className="dial" role="radiogroup" aria-label="Direction relative to you">
      <svg viewBox="-110 -110 220 220" className="dial-svg" aria-hidden="true">
        <circle r="92" fill="none" stroke="var(--line-strong)" />
        <circle r="60" fill="none" stroke="var(--line)" strokeDasharray="2 4" />
        <path d="M0 -26 L10 6 L0 0 L-10 6 Z" fill="var(--text)" />
        <circle r="3" fill="var(--text)" />
      </svg>
      {DIRECTIONS.map((_, i) => {
        const a = (i * Math.PI) / 4 - Math.PI / 2;
        const state = revealKey !== undefined ? (i === revealKey ? 'is-key' : i === selected ? 'is-wrong' : '') : i === selected ? 'is-selected' : '';
        return (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={selected === i}
            aria-label={LABELS[i]}
            className={`dial-btn ${state}`}
            style={{ left: `${50 + 42 * Math.cos(a)}%`, top: `${50 + 42 * Math.sin(a)}%` }}
            disabled={disabled}
            onClick={() => onSelect(i)}
          >
            <span className="mono">{i + 1}</span>
            <span className="dial-label">{LABELS[i]}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function OrientationItem({ item, disabled, onAnswer, reveal }: ItemRendererProps<OrientationContent>) {
  const c = item.content;
  const [hidden, setHidden] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const sent = useRef(false);

  useEffect(() => {
    if (!c.hideMapAfterMs || reveal) return;
    const t = window.setTimeout(() => setHidden(true), c.hideMapAfterMs);
    return () => clearTimeout(t);
  }, [c.hideMapAfterMs, reveal]);

  const submit = () => {
    if (selected === null || disabled || sent.current) return;
    sent.current = true;
    onAnswer({ kind: 'choice', index: selected });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 8) setSelected(n - 1);
      else if (e.key === 'ArrowRight') setSelected((s) => ((s ?? -1) + 1) % 8);
      else if (e.key === 'ArrowLeft') setSelected((s) => ((s ?? 1) + 7) % 8);
      else if (e.key === 'Enter') submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="task task-split">
      <div className="map-wrap">
        <Label>{hidden ? 'Map hidden' : 'Map'}</Label>
        <div className="map paper">
          {hidden ? (
            <p className="map-hidden mono">Work from memory</p>
          ) : (
            <svg viewBox="-6 -6 112 112" className="map-svg" role="img" aria-label={`Map with landmarks: ${c.landmarks.map((l) => l.name).join(', ')}`}>
              <rect x="-6" y="-6" width="112" height="112" fill="#ffffff" />
              {[20, 40, 60, 80].map((g) => (
                <g key={g}>
                  <line x1={g} y1="-6" x2={g} y2="106" stroke="#eef0f2" />
                  <line x1="-6" y1={g} x2="106" y2={g} stroke="#eef0f2" />
                </g>
              ))}
              {c.landmarks.map((l) => (
                <g key={l.name}>
                  <circle cx={l.x} cy={l.y} r="2.2" fill="#181a1d" />
                  <text x={l.x + 3.5} y={l.y - 3} fontSize="5" fontFamily="var(--font-sans)" fill="#181a1d">
                    {l.name}
                  </text>
                </g>
              ))}
            </svg>
          )}
        </div>
      </div>
      <div className="task">
        <p className="task-prompt task-prompt-left">{c.question}</p>
        <Dial selected={selected} onSelect={setSelected} disabled={disabled} revealKey={reveal ? (item.key as number) : undefined} />
        {reveal ? null : (
          <div className="choice-actions">
            <Button onClick={submit} disabled={selected === null || disabled} kbd="↵">
              Submit
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
