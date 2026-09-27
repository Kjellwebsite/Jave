'use client';

import { useCallback } from 'react';
import { useToast } from '../toast';
import type { FormAction } from './action-form';

/**
 * Wraps a Server Action so its success message is toasted as soon as the
 * result arrives. Use it for dialogs whose trigger disappears on success
 * (confirming a pending proposal, archiving an item): the revalidated page
 * unmounts the dialog in the same commit, before it could announce anything.
 */
export function useAnnouncedAction(action: FormAction): FormAction {
  const toast = useToast();
  return useCallback<FormAction>(
    async (state, data) => {
      const result = await action(state, data);
      if (result.status === 'success') toast(result.message);
      return result;
    },
    [action, toast],
  );
}
