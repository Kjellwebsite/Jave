import { useEffect, useRef, useState } from 'react';
import type { VerbalSpanContent } from '../../items/generators/span';
import { TextEntry } from '../runner/inputs';
import type { ItemRendererProps } from '../runner/types';
import { Label } from '../ui';

export default function VerbalSpanItem({ item, disabled, onAnswer, reveal }: ItemRendererProps<VerbalSpanContent>) {
  const { sequence, mode, itemMs } = item.content;
  const display = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'show' | 'input'>('show');
  const inputStart = useRef(0);

  useEffect(() => {
    const timers: number[] = [];
    const el = display.current;
    sequence.forEach((ch, i) => {
      timers.push(window.setTimeout(() => el && (el.textContent = ch), 600 + i * (itemMs + 150)));
      timers.push(window.setTimeout(() => el && (el.textContent = ''), 600 + i * (itemMs + 150) + itemMs));
    });
    timers.push(
      window.setTimeout(() => {
        inputStart.current = performance.now();
        setPhase('input');
      }, 600 + sequence.length * (itemMs + 150) + 100),
    );
    return () => timers.forEach(clearTimeout);
  }, [sequence, itemMs]);

  return (
    <div className="task">
      <p className="task-prompt">
        {mode === 'reverse' ? 'Type the characters in reverse order.' : 'Type the digits in ascending order, then the letters in alphabetical order.'}
      </p>
      {phase === 'show' ? (
        <div className="vspan-display mono" ref={display} aria-live="off" />
      ) : reveal ? (
        <p className="task-note">Answer: {String(item.key)}</p>
      ) : (
        <div className="task">
          <Label className="vspan-label">{sequence.length} characters</Label>
          <TextEntry maxLength={12} disabled={disabled} placeholder="Answer" pattern={/[^a-zA-Z0-9]/g} onSubmit={(v) => onAnswer({ kind: 'text', value: (v ?? '').toUpperCase() }, { rtMs: performance.now() - inputStart.current })} />
        </div>
      )}
    </div>
  );
}
