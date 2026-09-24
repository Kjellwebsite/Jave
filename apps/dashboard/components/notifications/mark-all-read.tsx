'use client';

import { startTransition, useActionState, useEffect } from 'react';
import { CheckCheck } from 'lucide-react';
import { Button } from '@jave/ui';
import { IDLE_STATE } from '@/lib/action-state';
import type { FormAction } from '../forms/action-form';
import { useToast } from '../toast';

export function MarkAllRead({ action, disabled }: { action: FormAction; disabled: boolean }) {
  const [state, dispatch, pending] = useActionState(action, IDLE_STATE);
  const toast = useToast();
  useEffect(() => {
    if (state.status !== 'idle') toast(state.message);
  }, [state, toast]);
  return (
    <Button
      iconLeft={CheckCheck}
      loading={pending}
      disabled={disabled}
      onClick={() => startTransition(() => dispatch(new FormData()))}
    >
      Mark all read
    </Button>
  );
}
