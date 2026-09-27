'use client';

import { Button } from '@jave/ui';
import type { FormAction } from '../forms/action-form';
import { useToastedAction } from '../toast';

/**
 * Marks one notification read. The result is always announced: a refusal
 * or failure (ended session, rejected origin, E- reference) is never silent,
 * and neither is success, although the button leaves with the unread state.
 */
export function MarkRead({ action, id }: { action: FormAction; id: string }) {
  const { run, pending } = useToastedAction(action);
  return (
    <Button
      size="sm"
      variant="ghost"
      loading={pending}
      onClick={() => {
        const data = new FormData();
        data.set('id', id);
        run(data);
      }}
    >
      Mark read
    </Button>
  );
}
