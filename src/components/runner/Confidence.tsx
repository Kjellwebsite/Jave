import { useEffect, useRef, useState } from 'react';
import { Button, Label } from '../ui';

/** "How likely is it that your answer is correct?" 0–100% in steps of 5. Must be set explicitly. */
export function Confidence({ onSubmit }: { onSubmit(value: number): void }) {
  const [value, setValue] = useState<number | null>(null);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  const submit = () => {
    if (value === null || done.current) return;
    done.current = true;
    onSubmit(value / 100);
  };
  return (
    <div className="confidence">
      <Label>Confidence</Label>
      <p className="confidence-q">How likely is it that your answer is correct?</p>
      <div className="confidence-value mono" aria-live="polite">
        {value === null ? '—' : `${value}%`}
      </div>
      <input
        ref={ref}
        type="range"
        min={0}
        max={100}
        step={5}
        value={value ?? 50}
        className={`confidence-range ${value === null ? 'is-unset' : ''}`}
        aria-label="Confidence that your answer is correct, in percent"
        aria-valuetext={value === null ? 'not set' : `${value} percent`}
        onChange={(e) => setValue(Number(e.target.value))}
        onPointerDown={() => value === null && setValue(50)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          } else if (value === null && /Arrow|Page|Home|End/.test(e.key)) setValue(50);
        }}
      />
      <div className="confidence-scale mono" aria-hidden="true">
        <span>0% · guessing</span>
        <span>50%</span>
        <span>100% · certain</span>
      </div>
      <Button onClick={submit} disabled={value === null} kbd="↵">
        Continue
      </Button>
    </div>
  );
}
