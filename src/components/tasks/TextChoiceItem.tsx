import { ChoiceGrid } from '../runner/inputs';
import type { ItemRendererProps } from '../runner/types';

/** Scenario or question with text options: probability and all authored banks. */
export interface TextChoiceContent {
  context?: string;
  scenario?: string;
  question: string;
  options: string[];
}

export default function TextChoiceItem({ item, disabled, onAnswer, reveal }: ItemRendererProps<TextChoiceContent>) {
  const c = item.content;
  const context = c.context ?? c.scenario;
  return (
    <div className="task">
      {context ? (
        <div className="task-text context-block">
          {context.split(/\n{2,}/).map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
      ) : null}
      <p className="task-prompt">{c.question}</p>
      <div className="narrow">
        <ChoiceGrid options={c.options} disabled={disabled} revealKey={reveal ? (item.key as number) : undefined} onSubmit={(index) => onAnswer({ kind: 'choice', index })} />
      </div>
    </div>
  );
}
