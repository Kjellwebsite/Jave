import { useState } from 'react';
import type { CategoryProblem, Stimulus } from '../../tasks/category';
import type { ProcedureRendererProps } from '../runner/types';
import { Button } from '../ui';
import { Creature } from './Creature';
import { Gate } from './Shell';

export default function CategoryRetainTask({ config, onComplete }: ProcedureRendererProps<{ problem: CategoryProblem; stimuli: Stimulus[]; available: boolean }>) {
  const [started, setStarted] = useState(false);
  const [i, setI] = useState(0);
  const [responses, setResponses] = useState<(0 | 1)[]>([]);
  if (!config.available) {
    return (
      <Gate title="Nothing to recall." onGo={() => onComplete({ responses: [] })} action="Continue">
        <p>The learning section was not completed in this session, so there is no rule to recall.</p>
      </Gate>
    );
  }
  if (!started)
    return (
      <Gate title="Remember your first rule." onGo={() => setStarted(true)} label="Retention">
        <p>Earlier you learned which objects belong to group A and which to group B in your first learning problem. Sort these objects using that first rule. There is no feedback.</p>
      </Gate>
    );
  const answer = (v: 0 | 1) => {
    const next = [...responses, v];
    setResponses(next);
    if (next.length >= config.stimuli.length) onComplete({ responses: next });
    else setI(i + 1);
  };
  return (
    <div className="task category">
      <div className="task-counter">
        <span>Retention</span>
        <span>{i + 1} / {config.stimuli.length}</span>
      </div>
      <div className="category-stim paper">
        <Creature s={config.stimuli[i]} size={180} />
      </div>
      <div className="category-actions">
        <Button variant="secondary" size="lg" onClick={() => answer(0)}>
          Group A
        </Button>
        <Button variant="secondary" size="lg" onClick={() => answer(1)}>
          Group B
        </Button>
      </div>
    </div>
  );
}
