import { useEffect, useRef, useState } from 'react';
import type { LayoutContent } from '../../items/generators/layout';
import type { ItemRendererProps } from '../runner/types';
import { Button } from '../ui';

export default function LayoutItem({ item, disabled, onAnswer, reveal }: ItemRendererProps<LayoutContent>) {
  const c = item.content;
  const [selected, setSelected] = useState<number | null>(null);
  const sent = useRef(false);
  const submit = () => {
    if (selected === null || disabled || sent.current) return;
    sent.current = true;
    onAnswer({ kind: 'choice', index: selected });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className="task">
      <p className="task-prompt">One element breaks the layout’s alignment or spacing system. Select it.</p>
      <div className="layout-canvas paper" style={{ aspectRatio: `${c.width} / ${c.height}` }}>
        {c.elements.map((el, i) => {
          const state = reveal ? (i === item.key ? 'is-key' : i === selected ? 'is-wrong' : '') : i === selected ? 'is-selected' : '';
          return (
            <button
              key={i}
              type="button"
              className={`layout-el kind-${el.kind} ${state}`}
              style={{ left: `${(el.x / c.width) * 100}%`, top: `${(el.y / c.height) * 100}%`, width: `${(el.w / c.width) * 100}%`, height: `${(el.h / c.height) * 100}%` }}
              aria-label={`${el.kind} ${i + 1}`}
              aria-pressed={selected === i}
              disabled={disabled}
              onClick={() => setSelected(i)}
            />
          );
        })}
      </div>
      {reveal ? null : (
        <div className="choice-actions layout-actions">
          <Button onClick={submit} disabled={selected === null || disabled} kbd="↵">
            Submit
          </Button>
        </div>
      )}
    </div>
  );
}
