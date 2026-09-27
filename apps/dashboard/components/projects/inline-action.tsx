'use client';

import { type FormEvent, useState, useTransition } from 'react';
import { Button, type ButtonSize, type ButtonVariant, cx } from '@jave/ui';
import { type ActionState, IDLE_STATE } from '@/lib/action-state';
import type { FormAction } from '../forms/action-form';
import { useToast } from '../toast';

export interface InlineActionProps {
  action: FormAction;
  /** Identifiers the action needs (validated and authorized server-side). */
  hidden: Record<string, string>;
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  'data-testid'?: string;
}

/**
 * A single-button Server Action for low-stakes, reversible steps (complete a
 * milestone, remove a link). Success is announced with a toast — even when
 * the refresh removes this button — and a refusal stays next to the button.
 * Consequential actions use ConfirmActionDialog.
 */
export function InlineAction({
  action,
  hidden,
  label,
  variant = 'ghost',
  size = 'sm',
  className,
  'data-testid': testId,
}: InlineActionProps) {
  const [state, setState] = useState<ActionState>(IDLE_STATE);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const next = await action(IDLE_STATE, data);
      setState(next);
      if (next.status === 'success') toast(next.message);
    });
  }

  return (
    <form onSubmit={handleSubmit} className={cx('inline-flex flex-col items-end gap-1', className)}>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" variant={variant} size={size} loading={pending} data-testid={testId}>
        {label}
      </Button>
      {state.status === 'error' ? (
        <p role="alert" className="max-w-56 text-right text-small text-danger">
          {state.message}
          {state.reference ? ` (${state.reference})` : ''}
        </p>
      ) : null}
    </form>
  );
}
