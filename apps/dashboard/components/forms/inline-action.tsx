'use client';

import type { FormEvent } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from '@jave/ui';
import type { FormAction } from './action-form';
import { useToastedAction } from '../toast';

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
 * milestone, remove a link, enable an integration). Every result — success,
 * refusal or failure with its reference — is announced as a toast raised by
 * the call itself, so it still appears when the refresh removes this button.
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
  const { run, pending } = useToastedAction(action);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(new FormData(event.currentTarget));
  }

  return (
    <form onSubmit={handleSubmit} className={className}>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" variant={variant} size={size} loading={pending} data-testid={testId}>
        {label}
      </Button>
    </form>
  );
}
