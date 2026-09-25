import { useEffect, useRef, useState } from 'react';
import type { ProcedureRendererProps } from '../runner/types';
import { Gate } from './Shell';

export default function TypingTask({ config, onComplete }: ProcedureRendererProps<{ text: string; durationMs: number }>) {
  const [started, setStarted] = useState(false);
  const [typed, setTyped] = useState('');
  const [left, setLeft] = useState(config.durationMs);
  const startAt = useRef<number | null>(null);
  const backspaces = useRef(0);
  const done = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (started) ref.current?.focus();
  }, [started]);

  useEffect(() => {
    if (!started) return;
    const t = window.setInterval(() => {
      if (startAt.current === null) return;
      const elapsed = performance.now() - startAt.current;
      setLeft(Math.max(0, config.durationMs - elapsed));
      if (elapsed >= config.durationMs && !done.current) {
        done.current = true;
        onComplete({ typed: ref.current?.value ?? '', elapsedMs: config.durationMs, backspaces: backspaces.current });
      }
    }, 100);
    return () => clearInterval(t);
  }, [started, config.durationMs, onComplete]);

  if (!started)
    return (
      <Gate title="Copy the passage." onGo={() => setStarted(true)} label="Typing">
        <p>Type the text exactly, including punctuation and capitals. The 60-second timer starts with your first keystroke. Corrections are allowed.</p>
      </Gate>
    );
  const finishEarly = typed.length >= config.text.length;
  if (finishEarly && !done.current && startAt.current !== null) {
    done.current = true;
    const elapsed = performance.now() - startAt.current;
    queueMicrotask(() => onComplete({ typed, elapsedMs: elapsed, backspaces: backspaces.current }));
  }
  return (
    <div className="task typing">
      <div className="task-counter">
        <span>Typing</span>
        <span>{startAt.current === null ? '60 s' : `${Math.ceil(left / 1000)} s`}</span>
      </div>
      <p className="typing-source" aria-label="Text to copy">
        {config.text.split('').map((ch, i) => (
          <span key={i} className={i < typed.length ? (typed[i] === ch ? 'is-ok' : 'is-err') : i === typed.length ? 'is-cursor' : ''}>
            {ch}
          </span>
        ))}
      </p>
      <textarea
        ref={ref}
        className="typing-input mono"
        value={typed}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        aria-label="Type the passage here"
        onKeyDown={(e) => {
          if (startAt.current === null && e.key.length === 1) startAt.current = performance.now();
          if (e.key === 'Backspace') backspaces.current++;
        }}
        onPaste={(e) => e.preventDefault()}
        onChange={(e) => {
          if (startAt.current === null) startAt.current = performance.now();
          setTyped(e.target.value.slice(0, config.text.length));
        }}
      />
    </div>
  );
}
