'use client';

import { startTransition, useActionState, useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button, type ButtonVariant, Mono } from '@jave/ui';
import { IDLE_STATE } from '@/lib/action-state';
import type { FormAction } from '../forms/action-form';
import { useToast } from '../toast';

export interface ActionButtonProps {
  action: FormAction;
  label: string;
  /** Identifiers the action needs (validated and authorized server-side). */
  hidden?: Record<string, string>;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  'data-testid'?: string;
}

/**
 * A one-click Server Action for low-stakes, repeatable operations (install
 * starters, re-sync channels). Success is announced with a toast; a refusal
 * stays next to the button. Consequential actions use ConfirmActionDialog.
 */
export function ActionButton({
  action,
  label,
  hidden = {},
  variant = 'secondary',
  size = 'md',
  icon,
  'data-testid': testId,
}: ActionButtonProps) {
  const [state, dispatch, pending] = useActionState(action, IDLE_STATE);
  const toast = useToast();
  useEffect(() => {
    if (state.status === 'success') toast(state.message);
  }, [state, toast]);

  function run() {
    const data = new FormData();
    for (const [name, value] of Object.entries(hidden)) data.set(name, value);
    startTransition(() => dispatch(data));
  }

  return (
    <span className="inline-flex max-w-full flex-col items-end gap-1.5">
      <Button
        variant={variant}
        size={size}
        iconLeft={icon}
        loading={pending}
        onClick={run}
        data-testid={testId}
      >
        {label}
      </Button>
      {state.status === 'error' ? (
        <span role="alert" className="max-w-xs text-right text-small text-danger">
          {state.message}
          {state.reference ? (
            <>
              {' '}
              <Mono className="select-all">{state.reference}</Mono>
            </>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
