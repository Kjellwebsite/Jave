import { Suspense, useCallback, useRef } from 'react';
import type { InputKind } from '../../types';
import { procedureRenderer } from '../tasks';

export function ProcedureStage({ paradigm, config, input, onComplete }: { paradigm: string; config: unknown; input: InputKind; onComplete(result: unknown): void }) {
  const Renderer = procedureRenderer(paradigm);
  const done = useRef(false);
  const complete = useCallback(
    (r: unknown) => {
      if (done.current) return;
      done.current = true;
      onComplete(r);
    },
    [onComplete],
  );
  return (
    <div className="procedure-stage">
      <Suspense fallback={<div className="renderer-loading" />}>
        <Renderer config={config} input={input} onComplete={complete} />
      </Suspense>
    </div>
  );
}
