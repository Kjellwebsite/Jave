'use client';

import { startTransition, useActionState } from 'react';
import { Button } from '@jave/ui';
import { IDLE_STATE } from '@/lib/action-state';
import type { FormAction } from '../forms/action-form';
import { useActionResultToast } from '../toast';

/**
 * Marks one notification read. The result is always announced: a refusal
 * or failure (ended session, rejected origin, E- reference) is never silent.
 */
export function MarkRead({ action, id }: { action: FormAction; id: string }) {
  const [state, dispatch, pending] = useActionState(action, IDLE_STATE);
  useActionResultToast(state);
  return (
    <Button
      size="sm"
      variant="ghost"
      loading={pending}
      onClick={() => {
        const data = new FormData();
        data.set('id', id);
        startTransition(() => dispatch(data));
      }}
    >
      Mark read
    </Button>
  );
}
