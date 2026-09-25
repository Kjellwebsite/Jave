import { useEffect, useRef, useState } from 'react';
import { checkConstraint, type Constraint } from '../../tasks/creative';
import type { ProcedureRendererProps } from '../runner/types';
import { Button, Label } from '../ui';
import { Gate } from './Shell';

export function UsesTask({ config, onComplete }: ProcedureRendererProps<{ objects: string[]; durationMs: number }>) {
  const [i, setI] = useState(0);
  const [started, setStarted] = useState(false);
  const [ideas, setIdeas] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [left, setLeft] = useState(config.durationMs);
  const all = useRef<string[][]>([]);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!started) return;
    ref.current?.focus();
    const start = performance.now();
    const t = window.setInterval(() => {
      const remain = config.durationMs - (performance.now() - start);
      setLeft(Math.max(0, remain));
      if (remain <= 0) {
        clearInterval(t);
        all.current[i] = ideasRef.current;
        if (i + 1 < config.objects.length) {
          setStarted(false);
          setIdeas([]);
          setI(i + 1);
        } else onComplete({ responses: all.current });
      }
    }, 200);
    return () => clearInterval(t);
  }, [started, i, config, onComplete]);

  const ideasRef = useRef<string[]>([]);
  ideasRef.current = ideas;

  if (!started)
    return (
      <Gate label={`Object ${i + 1} of ${config.objects.length}`} title={`Uses for a ${config.objects[i]}`} onGo={() => setStarted(true)}>
        <p>List as many different, unusual uses as you can in 90 seconds. Press Enter after each idea.</p>
      </Gate>
    );
  return (
    <div className="task uses">
      <div className="task-counter">
        <span>Uses for a {config.objects[i]}</span>
        <span>{Math.ceil(left / 1000)} s</span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) setIdeas([...ideas, draft.trim()]);
          setDraft('');
        }}
      >
        <input ref={ref} className="entry-input uses-input" value={draft} maxLength={200} onChange={(e) => setDraft(e.target.value)} placeholder="A use, then Enter" aria-label="New idea" />
      </form>
      <ol className="uses-list">
        {ideas.map((x, j) => (
          <li key={j}>{x}</li>
        ))}
      </ol>
    </div>
  );
}

export function ConstrainedTask({ config, onComplete }: ProcedureRendererProps<{ prompts: { task: string; constraints: Constraint[] }[] }>) {
  const [i, setI] = useState(0);
  const [text, setText] = useState('');
  const texts = useRef<string[]>([]);
  const p = config.prompts[i];
  return (
    <div className="task constrained">
      <div className="task-counter">
        <span>Constrained writing</span>
        <span>{i + 1} / {config.prompts.length}</span>
      </div>
      <p className="task-prompt">{p.task}</p>
      <ul className="constraint-list">
        {p.constraints.map((c, j) => {
          const ok = text.trim() ? checkConstraint(text, c) : false;
          return (
            <li key={j} className={ok ? 'is-ok' : ''}>
              <span className="constraint-mark" aria-hidden="true">{ok ? '✓' : '○'}</span>
              {c.label}
              <span className="sr-only">{ok ? ' — met' : ' — not met'}</span>
            </li>
          );
        })}
      </ul>
      <textarea className="typing-input" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} aria-label="Your response" autoFocus />
      <div className="choice-actions">
        <Label>Checked automatically</Label>
        <Button
          onClick={() => {
            texts.current[i] = text;
            if (i + 1 < config.prompts.length) {
              setI(i + 1);
              setText('');
            } else onComplete({ texts: texts.current });
          }}
          disabled={!text.trim()}
        >
          {i + 1 < config.prompts.length ? 'Next prompt' : 'Finish'}
        </Button>
      </div>
    </div>
  );
}
