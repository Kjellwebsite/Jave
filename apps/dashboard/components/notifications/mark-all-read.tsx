'use client';

import { CheckCheck } from 'lucide-react';
import { Button } from '@jave/ui';
import type { FormAction } from '../forms/action-form';
import { useToastedAction } from '../toast';

export function MarkAllRead({ action, disabled }: { action: FormAction; disabled: boolean }) {
  const { run, pending } = useToastedAction(action);
  return (
    <Button
      iconLeft={CheckCheck}
      loading={pending}
      disabled={disabled}
      onClick={() => run(new FormData())}
    >
      Mark all read
    </Button>
  );
}
