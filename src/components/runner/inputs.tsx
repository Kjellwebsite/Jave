import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Button, Kbd } from '../ui';
import './inputs.css';

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
};

/** Select an option, then confirm. Digits select; Enter confirms. Prevents accidental submission. */
export function ChoiceGrid({
  options,
  columns = 1,
  onSubmit,
  disabled,
  revealKey,
  className = '',
  optionClassName = '',
  submitLabel = 'Submit',
  ariaLabel = 'Answer options',
}: {
  options: ReactNode[];
  columns?: number;
  onSubmit(index: number): void;
  disabled?: boolean;
  revealKey?: number;
  className?: string;
  optionClassName?: string;
  submitLabel?: string;
  ariaLabel?: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const submitted = useRef(false);
  const submit = () => {
    if (selected === null || disabled || submitted.current) return;
    submitted.current = true;
    onSubmit(selected);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= options.length) {
        e.preventDefault();
        setSelected(n - 1);
      } else if (e.key === 'Enter' && selected !== null) {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className={`choice ${className}`}>
      <div className="choice-grid" role="radiogroup" aria-label={ariaLabel} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {options.map((o, i) => {
          const state = revealKey !== undefined ? (i === revealKey ? 'is-key' : i === selected ? 'is-wrong' : '') : i === selected ? 'is-selected' : '';
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={selected === i}
              aria-label={typeof o === 'string' ? undefined : `Option ${i + 1}`}
              className={`choice-option ${state} ${optionClassName}`}
              disabled={disabled}
              onClick={() => setSelected(i)}
            >
              <span className="choice-index mono" aria-hidden="true">
                {i + 1}
              </span>
              <span className="choice-body">{o}</span>
            </button>
          );
        })}
      </div>
      {revealKey === undefined ? (
        <div className="choice-actions">
          <Button onClick={submit} disabled={selected === null || disabled} kbd="↵">
            {submitLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function NumberEntry({ onSubmit, disabled, min, max, label = 'Your answer' }: { onSubmit(v: number): void; disabled?: boolean; min: number; max: number; label?: string }) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const submitted = useRef(false);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  const parsed = /^-?\d+$/.test(value.trim()) ? Number(value.trim()) : null;
  const valid = parsed !== null && parsed >= min && parsed <= max;
  const submit = () => {
    if (!valid || disabled || submitted.current) return;
    submitted.current = true;
    onSubmit(parsed!);
  };
  const press = (k: string) => {
    if (disabled) return;
    if (k === '⌫') setValue((v) => v.slice(0, -1));
    else if (k === '±') setValue((v) => (v.startsWith('-') ? v.slice(1) : `-${v}`));
    else setValue((v) => (v.length < 7 ? v + k : v));
  };
  return (
    <form
      className="entry"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="entry-field">
        <span className="sr-only">{label}</span>
        <input
          ref={ref}
          className="entry-input mono"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value.replace(/[^\d-]/g, '').slice(0, 7))}
          placeholder="—"
          aria-invalid={value !== '' && !valid}
        />
      </label>
      <div className="keypad" aria-hidden="true">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '±', '0', '⌫'].map((k) => (
          <button key={k} type="button" tabIndex={-1} className="keypad-key mono" onClick={() => press(k)} disabled={disabled}>
            {k}
          </button>
        ))}
      </div>
      <Button onClick={submit} disabled={!valid || disabled} kbd="↵">
        Submit
      </Button>
    </form>
  );
}

export function TextEntry({
  onSubmit,
  disabled,
  maxLength,
  placeholder = 'Type your answer',
  allowSkip = false,
  pattern,
}: {
  onSubmit(v: string | null): void;
  disabled?: boolean;
  maxLength: number;
  placeholder?: string;
  allowSkip?: boolean;
  pattern?: RegExp;
}) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const submitted = useRef(false);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  const submit = (skip = false) => {
    if (disabled || submitted.current) return;
    if (!skip && !value.trim()) return;
    submitted.current = true;
    onSubmit(skip ? null : value.trim());
  };
  return (
    <form
      className="entry entry-text"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="entry-field">
        <span className="sr-only">{placeholder}</span>
        <input
          ref={ref}
          className="entry-input mono"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          maxLength={maxLength}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => setValue(pattern ? e.target.value.replace(pattern, '') : e.target.value)}
        />
      </label>
      <div className="entry-actions">
        <Button onClick={() => submit()} disabled={!value.trim() || disabled} kbd="↵">
          Submit
        </Button>
        {allowSkip ? (
          <Button variant="ghost" onClick={() => submit(true)} disabled={disabled}>
            Skip
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function KeyHint({ keys, children }: { keys: string[]; children: ReactNode }) {
  return (
    <span className="key-hint">
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
      <span>{children}</span>
    </span>
  );
}
